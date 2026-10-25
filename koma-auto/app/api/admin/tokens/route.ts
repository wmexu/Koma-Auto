import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { generateRoleActivationToken } from '@/lib/crypto-security';
import { logAuditEvent } from '@/lib/audit';

export async function GET() {
  try {
    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    const tokens = await client`
      SELECT 
        t.id, t.token, t.role, t.bound_email, t.used_at, t.expires_at, t.is_revoked, t.created_at,
        u.email as used_by_email
      FROM role_activation_tokens t
      LEFT JOIN users u ON u.id = t.used_by
      ORDER BY t.created_at DESC;
    `;

    return NextResponse.json({ success: true, tokens });
  } catch (error: any) {
    console.error('[AdminTokens GET Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки токенов' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { role, boundEmail, expiresInDays = 7, staffUserId } = body;

    if (!role || !['courier', 'manager', 'director'].includes(role)) {
      return NextResponse.json({ error: 'Укажите роль (courier, manager или director)' }, { status: 400 });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    const newToken = generateRoleActivationToken();

    await client`
      INSERT INTO role_activation_tokens (
        token, role, created_by, bound_email, expires_at, created_at
      ) VALUES (
        ${newToken},
        ${role},
        ${staffUserId || null},
        ${boundEmail ? boundEmail.trim().toLowerCase() : null},
        NOW() + (${Number(expiresInDays)} || ' days')::INTERVAL,
        NOW()
      );
    `;

    logAuditEvent({
      userId: staffUserId || null,
      action: 'ROLE_ACTIVATED',
      entityType: 'token',
      entityId: newToken,
      details: { role, boundEmail, expiresInDays },
    });

    return NextResponse.json({
      success: true,
      token: newToken,
      role,
      message: `Сгенерирован новый шифр для роли ${role}: ${newToken}`,
    });
  } catch (error: any) {
    console.error('[AdminTokens POST Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка создания токена' }, { status: 500 });
  }
}
