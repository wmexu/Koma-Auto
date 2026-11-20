import { NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebaseAdmin';
import { verifyStaffSession } from '@/lib/admin-auth';

export async function GET(request: Request) {
  try {
    // 1. Strict Zero-Trust Security Check: Director only
    const auth = await verifyStaffSession(request, ['director']);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error || 'Access denied: Directors only' }, { status: auth.status || 403 });
    }

    // 2. Fetch all accounts from Firebase Admin
    const listUsersResult = await adminAuth.listUsers(1000);
    const accounts = listUsersResult.users.map((user) => ({
      uid: user.uid,
      email: user.email,
      creationTime: user.metadata.creationTime,
      lastSignIn: user.metadata.lastSignInTime,
    }));

    return NextResponse.json(accounts, { status: 200 });
  } catch (error: any) {
    console.error('[API Accounts GET Error]:', error);
    return NextResponse.json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
