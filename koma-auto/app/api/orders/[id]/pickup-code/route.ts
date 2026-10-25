import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import { logAuditEvent } from '@/lib/audit';

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

    // 1. If order was placed by an authenticated user, strictly require matching userId
    if (orderData?.userId) {
      if (!userId || String(orderData.userId).trim() !== String(userId).trim()) {
        return NextResponse.json({ error: 'Доступ к чужому заказу запрещен' }, { status: 403 });
      }
    } else {
      // 2. If it is an unauthenticated/guest order, require customer phone or email verification
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

    const code = orderData?.pickupCode;
    if (!code) {
      return NextResponse.json({ error: 'Код получения ещё не сформирован для данного заказа' }, { status: 404 });
    }

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
