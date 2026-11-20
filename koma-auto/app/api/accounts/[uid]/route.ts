import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';
import { verifyStaffSession } from '@/lib/admin-auth';
import { client, isDbConfigured } from '@/db';
import { logAuditEvent } from '@/lib/audit';

export async function DELETE(
  request: Request,
  context: { params: Promise<{ uid: string }> | { uid: string } }
) {
  try {
    // 1. Strict Zero-Trust Security Check: Director only
    const auth = await verifyStaffSession(request, ['director']);
    if (!auth.authorized) {
      return NextResponse.json(
        { success: false, error: auth.error || 'Доступ запрещен: только для директоров' },
        { status: auth.status || 403 }
      );
    }

    const resolvedParams = await Promise.resolve(context?.params || {});
    const targetUid = resolvedParams.uid;
    if (!targetUid) {
      return NextResponse.json(
        { success: false, error: 'Не указан идентификатор пользователя (UID)' },
        { status: 400 }
      );
    }

    // 2. Director Account Self-Protection Check
    if (
      targetUid === 'ohwKkhkKHmdaI5CkbcGJcunNuID2' ||
      targetUid === '09aENK2sWTYNE16eqVa1g5fBV9E2' ||
      auth.user?.id === targetUid
    ) {
      return NextResponse.json(
        { success: false, error: 'Защита системы: Нельзя удалить аккаунт директора' },
        { status: 400 }
      );
    }

    // 3. Resolve target user info (email & actual Firebase UID)
    let targetEmail: string | undefined;
    let actualFirebaseUid: string = targetUid;

    // A) Try direct Firebase lookup first
    try {
      const fbUser = await adminAuth.getUser(targetUid);
      targetEmail = fbUser.email;
      actualFirebaseUid = fbUser.uid;
    } catch (lookupErr: any) {
      console.warn(`[DeleteAccount] Firebase direct lookup for ${targetUid}:`, lookupErr?.message);
    }

    // B) If email not found yet, lookup in Neon PostgreSQL
    if (!targetEmail && client && isDbConfigured()) {
      try {
        const rows = await client`SELECT email FROM users WHERE id = ${targetUid} LIMIT 1;`;
        if (rows && rows.length > 0) {
          targetEmail = rows[0].email;
        }
      } catch (dbLookupErr) {
        console.warn(`[DeleteAccount] Neon DB lookup error for ${targetUid}:`, dbLookupErr);
      }
    }

    // C) If targetEmail is known but Firebase user wasn't found by targetUid, resolve by email
    if (targetEmail && actualFirebaseUid === targetUid) {
      try {
        const fbUserByEmail = await adminAuth.getUserByEmail(targetEmail);
        if (fbUserByEmail?.uid) {
          actualFirebaseUid = fbUserByEmail.uid;
        }
      } catch {
        // User may not exist in Firebase, which is valid for Neon-only records
      }
    }

    // 4. Additional director protection check by email
    if (targetEmail) {
      const lower = targetEmail.toLowerCase();
      if (lower === 'acooldumb123@gmail.com' || lower === 'kamoliddint@gmail.com') {
        return NextResponse.json(
          { success: false, error: 'Защита системы: Нельзя удалить аккаунт директора' },
          { status: 400 }
        );
      }
    }

    // 5. Delete user from Firebase Auth
    let fbDeleted = false;
    let fbError: string | null = null;
    try {
      await adminAuth.deleteUser(actualFirebaseUid);
      fbDeleted = true;
    } catch (fbErr: any) {
      if (fbErr?.code === 'auth/user-not-found') {
        fbDeleted = true; // User doesn't exist in Firebase Auth (already deleted or synced record)
      } else {
        fbError = fbErr?.message || String(fbErr);
        console.error('[DeleteAccount] Error deleting from Firebase:', fbErr);
      }
    }

    // 6. Delete user from Neon PostgreSQL (users and audit_logs)
    let neonDeleted = false;
    let neonError: string | null = null;
    if (client && isDbConfigured()) {
      try {
        if (targetEmail) {
          await client`DELETE FROM users WHERE id = ${targetUid} OR email ILIKE ${targetEmail};`;
          await client`DELETE FROM audit_logs WHERE user_id = ${targetUid} OR details::text ILIKE ${'%' + targetEmail + '%'};`;
        } else {
          await client`DELETE FROM users WHERE id = ${targetUid};`;
          await client`DELETE FROM audit_logs WHERE user_id = ${targetUid};`;
        }
        neonDeleted = true;
      } catch (dbErr: any) {
        neonError = dbErr?.message || String(dbErr);
        console.error('[DeleteAccount] Error deleting from Neon:', dbErr);
      }
    }

    // If both failed or Neon failed, inform the client clearly
    if (!neonDeleted && neonError) {
      return NextResponse.json(
        { success: false, error: `Ошибка базы данных Neon: ${neonError}` },
        { status: 500 }
      );
    }

    if (!fbDeleted && fbError) {
      return NextResponse.json(
        {
          success: false,
          error: `Ошибка Firebase Admin: ${fbError}`,
          neon: neonDeleted,
        },
        { status: 500 }
      );
    }

    // 7. Security Audit Log
    try {
      await logAuditEvent({
        userId: auth.user?.id || 'director',
        action: 'USER_DELETED',
        entityType: 'user',
        entityId: targetUid,
        details: {
          email: targetEmail,
          deletedBy: auth.user?.email,
          firebaseDeleted: fbDeleted,
          neonDeleted,
        },
      });
    } catch (auditErr) {
      console.warn('[DeleteAccount] Failed to record audit event:', auditErr);
    }

    return NextResponse.json(
      {
        success: true,
        message: `Пользователь ${targetEmail || targetUid} успешно удален`,
        firebase: fbDeleted,
        neon: neonDeleted,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[API Accounts DELETE Error]:', error);
    return NextResponse.json(
      { success: false, error: error?.message || 'Внутренняя ошибка сервера при удалении пользователя' },
      { status: 500 }
    );
  }
}
