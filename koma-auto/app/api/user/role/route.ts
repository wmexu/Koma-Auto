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

    // If neither owner nor staff, return unauthorized error so client never falsely overwrites staff roles
    if (!isOwner && !isStaff) {
      return NextResponse.json({ success: false, error: 'Требуется авторизация', role: 'customer' }, { status: 401 });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    let rows = await client`
      SELECT role, full_name, email
      FROM users
      WHERE id = ${String(userId)}
      LIMIT 1;
    `;

    const emailParam = searchParams.get('email');
    if (!rows || rows.length === 0) {
      if (emailParam) {
        rows = await client`
          SELECT role, full_name, email
          FROM users
          WHERE LOWER(email) = ${emailParam.trim().toLowerCase()}
          LIMIT 1;
        `;
      }
    }

    const isDirector = String(userId) === 'ohwKkhkKHmdaI5CkbcGJcunNuID2' || 
      Boolean(emailParam && emailParam.trim().toLowerCase() === 'acooldumb123@gmail.com') ||
      Boolean(rows && rows.length > 0 && rows[0].email && rows[0].email.toLowerCase() === 'acooldumb123@gmail.com');

    if (!rows || rows.length === 0) {
      return NextResponse.json({ success: true, role: isDirector ? 'director' : 'customer' });
    }

    return NextResponse.json({
      success: true,
      role: isDirector ? 'director' : (rows[0].role || 'customer'),
      fullName: rows[0].full_name || null,
      email: rows[0].email || null,
    });
  } catch (error: any) {
    console.error('[UserRole GET Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка получения роли' }, { status: 500 });
  }
}
