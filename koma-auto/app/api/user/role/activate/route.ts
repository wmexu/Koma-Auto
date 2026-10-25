import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { checkRateLimit, recordFailedAttempt, resetRateLimit } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown-ip';
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Слишком много попыток. Доступ заблокирован на ${rateCheck.remainingSeconds || 900} сек.` },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { token, userId, email, fullName } = body;

    if (!token || !userId) {
      return NextResponse.json({ error: 'Укажите 24-значный шифр доступа' }, { status: 400 });
    }

    const cleanToken = String(token).trim();
    if (cleanToken.length !== 24) {
      recordFailedAttempt(ip);
      return NextResponse.json({ error: 'Неверный формат: шифр должен содержать ровно 24 символа' }, { status: 400 });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    // Atomic transaction for single-use token consumption
    const result = await client.begin(async (sql) => {
      // Find token
      const tokenRows = await sql`
        SELECT id, token, role, bound_email, used_by, expires_at, is_revoked
        FROM role_activation_tokens
        WHERE token = ${cleanToken}
        FOR UPDATE;
      `;

      if (!tokenRows || tokenRows.length === 0) {
        return { success: false, status: 400, error: 'Шифр не существует или введен с ошибкой' };
      }

      const t = tokenRows[0];

      if (t.is_revoked) {
        return { success: false, status: 403, error: 'Этот шифр был аннулирован директором' };
      }

      if (t.used_by) {
        return { success: false, status: 403, error: 'Этот шифр уже был использован ранее другим сотрудником' };
      }

      if (t.expires_at && new Date() > new Date(t.expires_at)) {
        return { success: false, status: 403, error: 'Срок действия шифра истек' };
      }

      if (t.bound_email && email && t.bound_email.toLowerCase() !== email.toLowerCase()) {
        return { success: false, status: 403, error: `Этот шифр предназначен только для аккаунта ${t.bound_email}` };
      }

      // 1. First ensure user exists in `users` table so Foreign Key role_activation_tokens_used_by_fkey is satisfied
      const userEmail = email && email.includes('@') ? email.trim().toLowerCase() : `user_${userId}@koma.kz`;
      const displayName = fullName || 'Сотрудник';

      const existingUsers = await sql`
        SELECT id, email FROM users WHERE id = ${userId} OR email = ${userEmail} LIMIT 1;
      `;

      let targetUserId = userId;

      if (existingUsers && existingUsers.length > 0) {
        targetUserId = existingUsers[0].id;
        await sql`
          UPDATE users
          SET role = ${t.role},
              full_name = COALESCE(${displayName}, full_name),
              email = COALESCE(${userEmail}, email),
              updated_at = NOW()
          WHERE id = ${targetUserId};
        `;
      } else {
        await sql`
          INSERT INTO users (id, email, full_name, role, updated_at)
          VALUES (${userId}, ${userEmail}, ${displayName}, ${t.role}, NOW());
        `;
      }

      // 2. Mark token as used by targetUserId (foreign key is 100% valid)
      await sql`
        UPDATE role_activation_tokens
        SET used_by = ${targetUserId}, used_at = NOW()
        WHERE id = ${t.id};
      `;

      // 3. Record audit log
      await sql`
        INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (
          gen_random_uuid(),
          ${targetUserId},
          'ROLE_ACTIVATED',
          'user',
          ${targetUserId},
          ${JSON.stringify({ role: t.role, token: cleanToken, email: userEmail })}::jsonb,
          ${ip},
          NOW()
        );
      `;

      resetRateLimit(ip);
      return { success: true, role: t.role, message: `Роль успешно активирована!` };
    });

    if (!result.success) {
      recordFailedAttempt(ip);
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    const response = NextResponse.json({
      success: true,
      role: result.role,
      message: result.message,
    });

    // Set signed cookie for middleware
    response.cookies.set('koma_staff_role', result.role, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      path: '/',
      maxAge: 30 * 24 * 60 * 60, // 30 days
    });

    return response;
  } catch (error: any) {
    console.error('[RoleActivate Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка активации роли' }, { status: 500 });
  }
}
