import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { logAuditEvent } from '@/lib/audit';
import { verifyStaffSession } from '@/lib/admin-auth';

export async function GET(request: Request) {
  try {
    // 1. Strict Server-Side Authorization: Director and Manager can list users
    const auth = await verifyStaffSession(request, ['director', 'manager']);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const audience = searchParams.get('audience') || 'all'; // all, retail, wholesale, courier, manager, director
    const q = (searchParams.get('q') || '').trim().toLowerCase();

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    // Auto backfill: ensure any customer from orders who does not yet have a record is populated
    try {
      await client`
        INSERT INTO users (id, email, full_name, phone, role, is_blocked, failed_code_attempts, created_at, updated_at)
        SELECT DISTINCT ON (LOWER(o.customer_email))
          COALESCE(o.user_id, 'cust_' || SUBSTRING(MD5(LOWER(o.customer_email)), 1, 20)),
          LOWER(o.customer_email),
          o.customer_name,
          o.customer_phone,
          'customer',
          false,
          0,
          o.created_at,
          NOW()
        FROM orders o
        WHERE o.customer_email IS NOT NULL 
          AND o.customer_email != ''
          AND NOT EXISTS (
            SELECT 1 FROM users u WHERE LOWER(u.email) = LOWER(o.customer_email) OR (o.user_id IS NOT NULL AND u.id = o.user_id)
          );
      `;
    } catch (backfillErr) {
      console.warn('[AdminUsers] Auto backfill notice:', backfillErr);
    }

    // Auto-discover users from Firestore via REST API if caller has ID token
    const authHeader = request.headers.get('authorization');
    const token = authHeader && authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;
    const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

    if (token && projectId && token.includes('.')) {
      try {
        const firestoreRes = await fetch(
          `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/users`,
          {
            headers: {
              'Authorization': `Bearer ${token}`,
              'Content-Type': 'application/json',
            },
          }
        );
        if (firestoreRes.ok) {
          const fsData = await firestoreRes.json();
          const docs = fsData.documents || [];
          for (const doc of docs) {
            const pathParts = (doc.name || '').split('/');
            const uid = pathParts[pathParts.length - 1];
            const f = doc.fields || {};
            const email = f.email?.stringValue;
            if (uid && email) {
              const cleanEmail = String(email).trim().toLowerCase();
              const fullName = f.name?.stringValue || f.fullName?.stringValue || null;
              const phone = f.phone?.stringValue || null;
              const role = f.role?.stringValue || (f.clientType?.stringValue === 'wholesale' ? 'wholesale' : 'customer');
              const createdAt = doc.createTime ? new Date(doc.createTime) : new Date();

              await client`
                INSERT INTO users (id, email, full_name, phone, role, is_blocked, failed_code_attempts, created_at, updated_at)
                VALUES (${uid}, ${cleanEmail}, ${fullName}, ${phone}, ${role}, false, 0, ${createdAt}, NOW())
                ON CONFLICT (id) DO UPDATE SET
                  email = EXCLUDED.email,
                  full_name = COALESCE(EXCLUDED.full_name, users.full_name),
                  phone = COALESCE(EXCLUDED.phone, users.phone),
                  updated_at = NOW();
              `;
            }
          }
        }
      } catch (fsErr) {
        // Safe failover if firestore rules or network prevents direct REST list
      }
    }

    let usersList: any[] = await client`
      SELECT 
        u.id, u.email, u.full_name, u.phone, u.role, u.is_blocked, u.created_at,
        COUNT(o.id)::int as orders_count
      FROM users u
      LEFT JOIN orders o ON o.user_id = u.id
      GROUP BY u.id, u.email, u.full_name, u.phone, u.role, u.is_blocked, u.created_at
      ORDER BY u.created_at DESC;
    `;

    // Filter by audience: all, retail, wholesale, courier, manager, director
    if (audience === 'retail') {
      usersList = usersList.filter(u => u.role === 'customer');
    } else if (audience === 'wholesale') {
      usersList = usersList.filter(u => u.role === 'wholesale');
    } else if (audience === 'courier') {
      usersList = usersList.filter(u => u.role === 'courier');
    } else if (audience === 'manager') {
      usersList = usersList.filter(u => u.role === 'manager');
    } else if (audience === 'director') {
      usersList = usersList.filter(u => u.role === 'director');
    }

    // Filter by search query
    if (q) {
      usersList = usersList.filter(u => 
        (u.email && u.email.toLowerCase().includes(q)) ||
        (u.full_name && u.full_name.toLowerCase().includes(q)) ||
        (u.phone && u.phone.includes(q))
      );
    }

    return NextResponse.json({ success: true, count: usersList.length, users: usersList });
  } catch (error: any) {
    console.error('[AdminUsers Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки пользователей' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { targetUserId, newRole, staffUserId } = body;

    // Strict Server-Side Authorization: Only Director can elevate or change user roles
    const auth = await verifyStaffSession(request, ['director'], staffUserId);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!targetUserId || !newRole) {
      return NextResponse.json({ error: 'Не указан пользователь или новая роль' }, { status: 400 });
    }

    if (!['customer', 'wholesale', 'courier', 'manager', 'director'].includes(newRole)) {
      return NextResponse.json({ error: 'Недопустимая роль' }, { status: 400 });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    await client`
      UPDATE users
      SET role = ${newRole}, updated_at = NOW()
      WHERE id = ${targetUserId};
    `;

    logAuditEvent({
      userId: staffUserId || null,
      action: 'ROLE_CHANGED',
      entityType: 'user',
      entityId: targetUserId,
      details: { newRole },
    });

    return NextResponse.json({ success: true, message: `Роль пользователя изменена на "${newRole}"` });
  } catch (error: any) {
    console.error('[AdminUsers PATCH Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка изменения роли' }, { status: 500 });
  }
}
