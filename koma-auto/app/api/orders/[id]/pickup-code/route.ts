import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { logAuditEvent } from '@/lib/audit';
import { getOrderPickupCode } from '@/lib/pickup-code';
import { verifyStaffSession, getVerifiedCallerUid } from '@/lib/admin-auth';

type Props = {
  params: Promise<{ id: string }>;
};

export async function GET(request: Request, { params }: Props) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');

    if (!id) {
      return NextResponse.json({ error: 'ID заказа не указан' }, { status: 400 });
    }

    // Try finding order in Firestore first to check owner
    let orderData: any = null;
    try {
      const snap = await getDoc(doc(db, 'orders', id));
      if (snap.exists()) {
        orderData = snap.data();
      }
    } catch (e) {
      console.warn('[PickupCode] Firestore lookup failed, falling back to DB:', e);
    }

    // If not found in Firestore, check Neon PostgreSQL
    if (!orderData && isDbConfigured() && client) {
      try {
        const rows = await client`
          SELECT id, user_id, customer_name, customer_phone, customer_email, fulfillment_status
          FROM orders
          WHERE id = ${String(id)}
          LIMIT 1;
        `;
        if (rows && rows.length > 0) {
          const row = rows[0];
          orderData = {
            id: row.id,
            userId: row.user_id,
            customer: {
              name: row.customer_name,
              phone: row.customer_phone,
              email: row.customer_email,
            },
            fulfillmentStatus: row.fulfillment_status,
          };
        }
      } catch (dbErr) {
        console.warn('[PickupCode] Postgres lookup error:', dbErr);
      }
    }

    if (!orderData) {
      return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
    }

    // 1. If order was placed by an authenticated user, strictly require matching verified token or staff
    if (orderData?.userId) {
      const verifiedUid = await getVerifiedCallerUid(request);
      const isOwner = Boolean(verifiedUid && verifiedUid === orderData.userId);
      let isStaff = false;
      if (!isOwner) {
        const staffAuth = await verifyStaffSession(request, ['courier', 'manager', 'director']);
        isStaff = staffAuth.authorized;
      }

      if (!isOwner && !isStaff) {
        return NextResponse.json({ error: 'Доступ к чужому коду получения запрещен' }, { status: 403 });
      }
    } else {
      // 2. If it is an unauthenticated/guest order, require customer phone or email verification OR staff
      const staffAuth = await verifyStaffSession(request, ['courier', 'manager', 'director']);
      if (!staffAuth.authorized) {
        const reqPhone = (searchParams.get('phone') || '').replace(/\D/g, '');
        const reqEmail = (searchParams.get('email') || '').trim().toLowerCase();
        const orderPhone = (orderData?.customer?.phone || '').replace(/\D/g, '');
        const orderEmail = (orderData?.customer?.email || '').trim().toLowerCase();

        const phoneMatches = Boolean(orderPhone && reqPhone && orderPhone.endsWith(reqPhone.slice(-10)));
        const emailMatches = Boolean(orderEmail && reqEmail && orderEmail === reqEmail);

        if (!phoneMatches && !emailMatches) {
          return NextResponse.json(
            { error: 'Для доступа к коду получения подтвердите номер телефона или email получателя' },
            { status: 403 }
          );
        }
      }
    }

    // Always get a valid 12-digit code
    const code = getOrderPickupCode(id, orderData?.pickupCode);

    // Log security view event
    logAuditEvent({
      userId: userId || null,
      action: 'PICKUP_CODE_VIEWED',
      entityType: 'order',
      entityId: id,
    });

    return NextResponse.json({
      success: true,
      pickupCode: code,
      fulfillmentStatus: orderData?.fulfillmentStatus || 'assembling',
    });
  } catch (error: any) {
    console.error('[GetPickupCode Error]:', error);
    return NextResponse.json({ error: 'Ошибка получения кода' }, { status: 500 });
  }
}
