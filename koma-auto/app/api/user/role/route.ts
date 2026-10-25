import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { verifyStaffSession, getVerifiedCallerUid } from '@/lib/admin-auth';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || request.headers.get('x-user-id');

    if (!userId) {
      return NextResponse.json({ error: 'userId обязателен' }, { status: 400 });
    }

    // Zero-Trust: Caller must match userId or be authenticated staff
    const verifiedUid = await getVerifiedCallerUid(request);
    const isOwner = Boolean(verifiedUid && verifiedUid === userId);
    let isStaff = false;
    if (!isOwner) {
      const staffAuth = await verifyStaffSession(request, ['director', 'manager']);
      isStaff = staffAuth.authorized;
    }

    // If neither owner nor staff, return safe default without revealing staff existence
    if (!isOwner && !isStaff) {
      return NextResponse.json({ success: true, role: 'customer' });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    const rows = await client`
      SELECT role
      FROM users
      WHERE id = ${String(userId)}
      LIMIT 1;
    `;

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: true, role: 'customer' });
    }

    // Return ONLY the role without leaking personal info (email, name, phone)
    return NextResponse.json({
      success: true,
      role: rows[0].role || 'customer',
    });
  } catch (error: any) {
    console.error('[UserRole GET Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка получения роли' }, { status: 500 });
  }
}
