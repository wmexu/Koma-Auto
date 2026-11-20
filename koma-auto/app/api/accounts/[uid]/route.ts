import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';
import { verifyStaffSession } from '@/lib/admin-auth';
import { client, isDbConfigured } from '@/db';
import { logAuditEvent } from '@/lib/audit';

interface RouteContext {
  params: Promise<{ uid: string }>;
}

export async function DELETE(request: Request, context: RouteContext) {
  try {
    // 1. Strict Zero-Trust Security Check: Director only
    const auth = await verifyStaffSession(request, ['director']);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Access denied: Directors only' }, { status: auth.status || 403 });
    }

    const { uid: targetUid } = await context.params;
    if (!targetUid) {
      return NextResponse.json({ error: 'Missing UID' }, { status: 400 });
    }

    // 2. Director Account Self-Protection Check
    if (
      targetUid === 'ohwKkhkKHmdaI5CkbcGJcunNuID2' ||
      targetUid === '09aENK2sWTYNE16eqVa1g5fBV9E2' ||
      auth.user?.id === targetUid
    ) {
      return NextResponse.json({ error: 'Защита системы: Нельзя удалить аккаунт директора' }, { status: 400 });
    }

    // 3. Lookup user info to get email if available
    let targetEmail: string | undefined;
    try {
      const fbUser = await adminAuth.getUser(targetUid);
      targetEmail = fbUser.email;
    } catch (lookupErr: any) {
      console.warn(`[DeleteAccount] Lookup in Firebase for ${targetUid}:`, lookupErr?.message);
    }

    // If not found in Firebase, look up in Neon
    if (!targetEmail && client && isDbConfigured()) {
      try {
        const rows = await client`SELECT email FROM users WHERE id = ${targetUid} LIMIT 1;`;
        if (rows && rows.length > 0) {
          targetEmail = rows[0].email;
        }
      } catch {}
    }

    // Additional director protection check by email
    if (targetEmail) {
      const lower = targetEmail.toLowerCase();
      if (lower === 'acooldumb123@gmail.com' || lower === 'kamoliddint@gmail.com') {
        return NextResponse.json({ error: 'Защита системы: Нельзя удалить аккаунт директора' }, { status: 400 });
      }
    }

    // 4. Delete user from Firebase Auth
    let fbDeleted = false;
    try {
      await adminAuth.deleteUser(targetUid);
      fbDeleted = true;
    } catch (fbErr: any) {
      if (fbErr?.code === 'auth/user-not-found') {
        console.log(`[DeleteAccount] User ${targetUid} was not found in Firebase (already deleted).`);
      } else {
        console.error('[DeleteAccount] Error deleting from Firebase:', fbErr);
      }
    }

    // 5. Delete user from Neon PostgreSQL
    let neonDeleted = false;
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
        console.error('[DeleteAccount] Error deleting from Neon:', dbErr);
      }
    }

    // 6. Security Audit Log
    logAuditEvent({
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

    return NextResponse.json(
      {
        success: true,
        message: `Account ${targetUid} deleted`,
        firebase: fbDeleted,
        neon: neonDeleted,
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error('[API Accounts DELETE Error]:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
