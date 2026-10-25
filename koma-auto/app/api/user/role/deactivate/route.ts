import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { logAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, targetClientType = 'retail' } = body;

    if (!userId) {
      return NextResponse.json({ error: 'Идентификатор пользователя не указан' }, { status: 400 });
    }

    const headerUserId = request.headers.get('x-user-id');
    const authHeader = request.headers.get('authorization');
    const bearerUid = authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null;

    // Verify session
    const effectiveCallerId = headerUserId || bearerUid || userId;
    if (effectiveCallerId !== userId) {
      return NextResponse.json({ error: 'Доступ запрещен: нельзя снять роль с чужого аккаунта' }, { status: 403 });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    const newRole = targetClientType === 'wholesale' ? 'wholesale' : 'customer';

    // 1. Downgrade in Neon PostgreSQL
    await client`
      UPDATE users
      SET role = ${newRole}, updated_at = NOW()
      WHERE id = ${userId};
    `;

    // 2. Downgrade in Firestore
    try {
      await setDoc(
        doc(db, 'users', userId),
        { role: newRole, clientType: targetClientType, updatedAt: new Date().toISOString() },
        { merge: true }
      );
    } catch (fbErr) {
      console.warn('[RoleDeactivate] Firestore update notice:', fbErr);
    }

    // 3. Record Audit
    logAuditEvent({
      userId,
      action: 'ROLE_REVOKED',
      entityType: 'user',
      entityId: userId,
      details: { revertedToRole: newRole, targetClientType },
      ipAddress: request.headers.get('x-forwarded-for') || null,
    });

    return NextResponse.json({
      success: true,
      message: 'Вы успешно вышли из статуса сотрудника',
      role: newRole,
      clientType: targetClientType,
    });
  } catch (error: any) {
    console.error('[RoleDeactivate Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка снятия роли сотрудника' }, { status: 500 });
  }
}
