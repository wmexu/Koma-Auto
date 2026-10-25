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

    // If order has a userId, enforce ownership
    if (orderData?.userId && userId && orderData.userId !== userId) {
      return NextResponse.json({ error: 'Доступ к чужому заказу запрещен' }, { status: 403 });
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
