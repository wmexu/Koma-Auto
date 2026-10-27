import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { verifyStaffSession } from '@/lib/admin-auth';
import { logAuditEvent } from '@/lib/audit';

interface UserSyncItem {
  id: string;
  email: string;
  fullName?: string | null;
  phone?: string | null;
  role?: string | null;
  clientType?: string | null;
  createdAt?: string | null;
}

export async function POST(request: Request) {
  try {
    // 1. Strict Server-Side Authorization: Only Director and Manager can trigger batch user sync
    const auth = await verifyStaffSession(request, ['director', 'manager']);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    const body = await request.json();
    const users: UserSyncItem[] = body.users || [];

    if (!Array.isArray(users) || users.length === 0) {
      return NextResponse.json({ success: true, processed: 0, message: 'Нет пользователей для синхронизации' });
    }

    let processedCount = 0;

    for (const u of users) {
      if (!u.id || !u.email) continue;
      const cleanEmail = String(u.email).trim().toLowerCase();
      const cleanName = u.fullName ? String(u.fullName).trim() : null;
      const cleanPhone = u.phone ? String(u.phone).trim() : null;
      const targetRole = u.role || (u.clientType === 'wholesale' ? 'wholesale' : 'customer');
      const userId = String(u.id);

      try {
        // A. Check if user exists by ID
        const byId = await client`
          SELECT id, email, full_name, phone, role
          FROM users
          WHERE id = ${userId}
          LIMIT 1;
        `;

        if (byId && byId.length > 0) {
          const currentRole = byId[0].role;
          const isElevated = ['courier', 'manager', 'director'].includes(currentRole);
          const finalRole = isElevated ? currentRole : targetRole;

          await client`
            UPDATE users
            SET
              email = ${cleanEmail},
              full_name = COALESCE(${cleanName}, full_name),
              phone = COALESCE(${cleanPhone}, phone),
              role = ${finalRole},
              updated_at = NOW()
            WHERE id = ${userId};
          `;
          processedCount++;
          continue;
        }

        // B. Check if user exists by EMAIL (relink ID if changed)
        const byEmail = await client`
          SELECT id, email, full_name, phone, role
          FROM users
          WHERE LOWER(email) = ${cleanEmail}
          LIMIT 1;
        `;

        if (byEmail && byEmail.length > 0) {
          const oldId = byEmail[0].id;
          const currentRole = byEmail[0].role;
          const isElevated = ['courier', 'manager', 'director'].includes(currentRole);
          const finalRole = isElevated ? currentRole : targetRole;

          // Re-link foreign keys to new Firebase UID
          try {
            await client`UPDATE orders SET user_id = ${userId} WHERE user_id = ${oldId};`;
            await client`UPDATE role_activation_tokens SET used_by = ${userId} WHERE used_by = ${oldId};`;
            await client`UPDATE promocodes SET bound_user_id = ${userId} WHERE bound_user_id = ${oldId};`;
          } catch (fkErr) {
            console.warn('[BatchSync] FK relink warning:', fkErr);
          }

          await client`
            UPDATE users
            SET
              id = ${userId},
              full_name = COALESCE(${cleanName}, full_name),
              phone = COALESCE(${cleanPhone}, phone),
              role = ${finalRole},
              updated_at = NOW()
            WHERE id = ${oldId};
          `;
          processedCount++;
          continue;
        }

        // C. Clean insert for new user
        const createdAtVal = u.createdAt ? new Date(u.createdAt) : new Date();
        await client`
          INSERT INTO users (
            id, email, full_name, phone, role, is_blocked, failed_code_attempts, created_at, updated_at
          ) VALUES (
            ${userId},
            ${cleanEmail},
            ${cleanName},
            ${cleanPhone},
            ${targetRole},
            false,
            0,
            ${createdAtVal},
            NOW()
          );
        `;
        processedCount++;
      } catch (userErr) {
        console.warn(`[BatchSync] Error syncing user ${cleanEmail}:`, userErr);
      }
    }

    logAuditEvent({
      userId: auth.user?.id || 'admin',
      action: 'USER_SYNCED',
      entityType: 'user',
      entityId: 'batch',
      details: { totalReceived: users.length, processedCount },
    });

    return NextResponse.json({
      success: true,
      processed: processedCount,
      message: `Успешно синхронизировано ${processedCount} пользователей`,
    });
  } catch (error: any) {
    console.error('[AdminUsersBatchSync Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка пакетной синхронизации' }, { status: 500 });
  }
}
