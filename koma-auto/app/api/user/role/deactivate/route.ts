import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { db } from '@/lib/firebase';
import { doc, setDoc } from 'firebase/firestore';
import { logAuditEvent } from '@/lib/audit';
import { verifyStaffSession, getVerifiedCallerUid } from '@/lib/admin-auth';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { userId, targetClientType = 'retail' } = body;

    if (!userId) {
      return NextResponse.json({ error: 'Идентификатор пользователя не указан' }, { status: 400 });
    }

    // Zero-Trust: Caller must cryptographically prove ownership of this account OR be Director
    const verifiedUid = await getVerifiedCallerUid(request);
    let isAuthorized = Boolean(verifiedUid && verifiedUid === userId);
    if (!isAuthorized) {
      const staffAuth = await verifyStaffSession(request, ['director']);
      isAuthorized = staffAuth.authorized;
    }

    if (!isAuthorized) {
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
