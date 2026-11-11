import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { getVerifiedCallerUid, verifyStaffSession } from '@/lib/admin-auth';
import { logAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, email, fullName, phone, clientType, dob } = body;

    if (!userId || !email) {
      return NextResponse.json({ error: 'userId и email обязательны' }, { status: 400 });
    }

    // Zero-Trust: Caller must be the user themselves (matching UID) or an authorized staff member
    const verifiedUid = await getVerifiedCallerUid(request);
    const isOwner = Boolean(verifiedUid && verifiedUid === userId);
    let isStaff = false;
    if (!isOwner) {
      const staffAuth = await verifyStaffSession(request, ['director', 'manager']);
      isStaff = staffAuth.authorized;
    }

    if (!isOwner && !isStaff) {
      return NextResponse.json({ error: 'Доступ запрещен: требуется авторизация' }, { status: 403 });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    const cleanEmail = String(email).trim().toLowerCase();
    const cleanName = fullName ? String(fullName).trim() : null;
    const cleanPhone = phone ? String(phone).trim() : null;
    const cleanClientType = clientType ? String(clientType).trim() : 'retail';
    const isDirector = String(userId) === 'ohwKkhkKHmdaI5CkbcGJcunNuID2' || cleanEmail === 'acooldumb123@gmail.com';
    // Zero-Trust: Wholesale can NEVER be self-assigned. All self-registered users are strictly 'customer', unless director.
    const desiredRole = isDirector ? 'director' : 'customer';
    const isExplicitUpdate = Boolean(body.isExplicitUpdate);

    const isPlaceholderOrTestName = (name: string | null | undefined): boolean => {
      if (!name) return true;
      const lower = name.trim().toLowerCase();
      return (
        lower === 'покупатель' ||
        lower === 'пользователь' ||
        lower === 'клиент' ||
        lower.includes('тестовый заказ') ||
        lower.includes('тестовый покупатель') ||
        lower === 'тест' ||
        lower === 'test' ||
        lower === 'test user'
      );
    };

    // 1. Check if user with this ID already exists
    const byId = await client`
      SELECT id, email, full_name, phone, role
      FROM users
      WHERE id = ${String(userId)}
      LIMIT 1;
    `;

    if (byId && byId.length > 0) {
      // User exists with same ID: safely update metadata without overwriting elevated staff roles or staff-assigned wholesale
      const currentRole = byId[0].role;
      const isProtectedRole = ['wholesale', 'courier', 'cashier', 'manager', 'director'].includes(currentRole);
      const finalRole = isDirector ? 'director' : (isProtectedRole ? currentRole : 'customer');

      const existingName = byId[0].full_name;
      const isExistingReal = Boolean(existingName && !isPlaceholderOrTestName(existingName));
      const isIncomingReal = Boolean(cleanName && !isPlaceholderOrTestName(cleanName));

      // If explicit update was requested from Profile editing OR incoming is a valid name while existing was a test/empty name, adopt it
      const finalName = isExplicitUpdate 
        ? (cleanName || existingName) 
        : (isIncomingReal && !isExistingReal ? cleanName : (cleanName || existingName));

      await client`
        UPDATE users
        SET 
          email = ${cleanEmail},
          full_name = ${finalName},
          phone = COALESCE(${cleanPhone}, phone),
          role = ${finalRole},
          client_type = COALESCE(${cleanClientType}, client_type, 'retail'),
          updated_at = NOW()
        WHERE id = ${String(userId)};
      `;

      // Authoritative propagation: Keep all customer orders in sync with the unified user name
      if (finalName && finalName !== 'Покупатель') {
        await client`
          UPDATE orders
          SET customer_name = ${finalName}, updated_at = NOW()
          WHERE user_id = ${String(userId)}
             OR (customer_email IS NOT NULL AND LOWER(customer_email) = ${cleanEmail});
        `.catch((ordErr) => {
          console.warn('[UserSync] Error updating orders customer_name:', ordErr);
        });
      }

      return NextResponse.json({
        success: true,
        message: 'Пользователь успешно синхронизирован',
        user: { id: userId, email: cleanEmail, fullName: finalName, role: finalRole },
      });
    }

    // 2. Check if a user with this EMAIL already exists (e.g., from prior checkout or legacy record)
    const byEmail = await client`
      SELECT id, email, full_name, phone, role
      FROM users
      WHERE LOWER(email) = ${cleanEmail}
      LIMIT 1;
    `;

    if (byEmail && byEmail.length > 0) {
      const oldId = byEmail[0].id;
      const currentRole = byEmail[0].role;
      const isProtectedRole = ['wholesale', 'courier', 'cashier', 'manager', 'director'].includes(currentRole);
      const finalRole = isDirector ? 'director' : (isProtectedRole ? currentRole : 'customer');

      const existingName = byEmail[0].full_name;
      const isExistingReal = Boolean(existingName && !isPlaceholderOrTestName(existingName));
      const isIncomingReal = Boolean(cleanName && !isPlaceholderOrTestName(cleanName));

      const finalName = isExplicitUpdate 
        ? (cleanName || existingName) 
        : (isIncomingReal && !isExistingReal ? cleanName : (cleanName || existingName));

      // Re-link foreign keys to the new Firebase UID
      try {
        await client`UPDATE orders SET user_id = ${String(userId)} WHERE user_id = ${oldId};`;
        await client`UPDATE role_activation_tokens SET used_by = ${String(userId)} WHERE used_by = ${oldId};`;
        await client`UPDATE promocodes SET bound_user_id = ${String(userId)} WHERE bound_user_id = ${oldId};`;
      } catch (fkErr) {
        console.warn('[UserSync] FK relink warning:', fkErr);
      }

      await client`
        UPDATE users
        SET 
          id = ${String(userId)},
          full_name = ${finalName},
          phone = COALESCE(${cleanPhone}, phone),
          role = ${finalRole},
          client_type = COALESCE(${cleanClientType}, client_type, 'retail'),
          updated_at = NOW()
        WHERE id = ${oldId};
      `;

      // Authoritative propagation: Keep all customer orders in sync with the unified user name
      if (finalName && finalName !== 'Покупатель') {
        await client`
          UPDATE orders
          SET customer_name = ${finalName}, updated_at = NOW()
          WHERE user_id = ${String(userId)}
             OR user_id = ${oldId}
             OR (customer_email IS NOT NULL AND LOWER(customer_email) = ${cleanEmail});
        `.catch((ordErr) => {
          console.warn('[UserSync] Error updating orders customer_name by email:', ordErr);
        });
      }

      return NextResponse.json({
        success: true,
        message: 'Пользователь успешно привязан и синхронизирован',
        user: { id: userId, email: cleanEmail, fullName: finalName, role: finalRole },
      });
    }

    // 3. User does not exist at all -> Insert clean new user record
    await client`
      INSERT INTO users (
        id, email, full_name, phone, role, client_type, is_blocked, failed_code_attempts, created_at, updated_at
      ) VALUES (
        ${String(userId)},
        ${cleanEmail},
        ${cleanName},
        ${cleanPhone},
        ${desiredRole},
        ${cleanClientType},
        false,
        0,
        NOW(),
        NOW()
      );
    `;

    logAuditEvent({
      userId: String(userId),
      action: 'USER_REGISTERED',
      entityType: 'user',
      entityId: String(userId),
      details: { email: cleanEmail, role: desiredRole },
    });

    return NextResponse.json({
      success: true,
      message: 'Новый пользователь успешно создан в PostgreSQL',
      user: { id: userId, email: cleanEmail, role: desiredRole },
    });
  } catch (error: any) {
    console.error('[UserSync Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка синхронизации пользователя' }, { status: 500 });
  }
}
