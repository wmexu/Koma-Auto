import { client, isDbConfigured } from '@/db';
import { logAuditEvent } from '@/lib/audit';

export interface StaffAuthResult {
  authorized: boolean;
  status: number;
  error?: string;
  user?: {
    id: string;
    email: string;
    fullName: string;
    role: string;
  };
}

/**
 * Server-side Zero-Trust Staff & Role Verification Guard
 * Verifies that the requesting user exists in PostgreSQL `users` table,
 * is not blocked, and possesses one of the allowed staff roles.
 */
export async function verifyStaffSession(
  request: Request,
  allowedRoles: ('courier' | 'manager' | 'director')[] = ['courier', 'manager', 'director'],
  explicitUserId?: string | null
): Promise<StaffAuthResult> {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown-ip';

    // 1. Extract userId from headers, query parameters, or explicit argument
    let userId = explicitUserId;
    if (!userId) {
      userId = request.headers.get('x-staff-user-id');
    }
    if (!userId) {
      const authHeader = request.headers.get('authorization');
      if (authHeader && authHeader.startsWith('Bearer ')) {
        userId = authHeader.slice(7).trim();
      }
    }
    if (!userId) {
      try {
        const url = new URL(request.url);
        userId = url.searchParams.get('staffUserId') || url.searchParams.get('userId');
      } catch {}
    }

    if (!userId) {
      logAuditEvent({
        userId: null,
        action: 'UNAUTHORIZED_ADMIN_ACCESS_ATTEMPT',
        entityType: 'admin_api',
        entityId: 'unauthenticated',
        details: { ip, reason: 'missing_user_id' },
      });
      return {
        authorized: false,
        status: 401,
        error: 'Доступ ограничен: требуется авторизация сотрудника (отсутствует идентификатор сессии)',
      };
    }

    if (!isDbConfigured() || !client) {
      return { authorized: false, status: 503, error: 'База данных недоступна' };
    }

    // 2. Query user from database
    const users = await client`
      SELECT id, email, full_name, role, is_blocked, blocked_until
      FROM users
      WHERE id = ${userId}
      LIMIT 1;
    `;

    if (!users || users.length === 0) {
      logAuditEvent({
        userId,
        action: 'FORBIDDEN_ADMIN_ACCESS_ATTEMPT',
        entityType: 'admin_api',
        entityId: userId,
        details: { ip, reason: 'user_not_found_in_database' },
      });
      return {
        authorized: false,
        status: 403,
        error: 'Доступ запрещен: ваш аккаунт не зарегистрирован в служебной системе',
      };
    }

    const u = users[0];

    // 3. Check if user is blocked
    if (u.is_blocked || (u.blocked_until && new Date() < new Date(u.blocked_until))) {
      logAuditEvent({
        userId: u.id,
        action: 'BLOCKED_USER_ACCESS_ATTEMPT',
        entityType: 'admin_api',
        entityId: u.id,
        details: { ip, blockedUntil: u.blocked_until },
      });
      return {
        authorized: false,
        status: 403,
        error: 'Доступ заблокирован администратором безопасности',
      };
    }

    // 4. Role check
    if (!allowedRoles.includes(u.role)) {
      logAuditEvent({
        userId: u.id,
        action: 'INSUFFICIENT_PRIVILEGES_ATTEMPT',
        entityType: 'admin_api',
        entityId: u.id,
        details: { ip, userRole: u.role, requiredRoles: allowedRoles },
      });
      return {
        authorized: false,
        status: 403,
        error: `Доступ запрещен: требуется одна из ролей [${allowedRoles.join(', ')}]. Ваша роль: ${u.role}`,
      };
    }

    return {
      authorized: true,
      status: 200,
      user: {
        id: u.id,
        email: u.email,
        fullName: u.full_name,
        role: u.role,
      },
    };
  } catch (error: any) {
    console.error('[verifyStaffSession Error]:', error);
    return {
      authorized: false,
      status: 500,
      error: 'Внутренняя ошибка проверки прав доступа',
    };
  }
}
