import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { verifyStaffSession } from '@/lib/admin-auth';

export async function GET(request: Request) {
  try {
    // Strict Server-Side Authorization: Only Managers and Directors can list couriers
    const auth = await verifyStaffSession(request, ['manager', 'director']);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    const couriers = await client`
      SELECT id, email, full_name, phone, role
      FROM users
      WHERE role = 'courier' AND is_blocked = false
      ORDER BY full_name ASC, email ASC;
    `;

    return NextResponse.json({ success: true, couriers });
  } catch (error: any) {
    console.error('[AdminCouriers Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки курьеров' }, { status: 500 });
  }
}
