import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Order, OrderStatus } from '@/lib/order-types';
import { createMoySkladOrder, notifyMoySkladOrderPaid } from '@/lib/moysklad-order';
import { verifyEpayPayment } from '@/lib/epay-refund';

export async function POST(request: Request) {
  try {
    const order = (await request.json()) as Order;

    if (!order || !order.id) {
      return NextResponse.json({ error: 'Некорректные данные заказа' }, { status: 400 });
    }

    // 1. Save in Firestore
    try {
      const orderRef = doc(db, 'orders', order.id);
      await setDoc(orderRef, order, { merge: true });

      if (order.userId) {
        const userOrderRef = doc(db, 'users', order.userId, 'orders', order.id);
        await setDoc(userOrderRef, order, { merge: true });
      }
    } catch (fbErr) {
      console.warn('Firestore order save error (continuing):', fbErr);
    }

    // 2. Create Order in MoySklad (status "Новый", without notification until paid)
    let moySkladResult = null;
    try {
      moySkladResult = await createMoySkladOrder(order);
    } catch (msErr) {
      console.error('MoySklad order creation exception:', msErr);
    }

    return NextResponse.json({
      success: true,
      order,
      moySkladResult,
    });
  } catch (error: any) {
    console.error('Error creating order in API:', error);
    return NextResponse.json(
      { error: error?.message || 'Ошибка обработки заказа' },
      { status: 500 }
    );
  }
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId');
    const orderId = searchParams.get('orderId');

    if (orderId) {
      const docSnap = await getDoc(doc(db, 'orders', orderId));
      if (!docSnap.exists()) {
        return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
      }
      return NextResponse.json(docSnap.data());
    }

    if (!userId) {
      return NextResponse.json({ error: 'Параметр userId обязателен' }, { status: 400 });
    }

    const ordersCol = collection(db, 'orders');
    const q = query(ordersCol, where('userId', '==', userId));
    const snapshot = await getDocs(q);

    const orders: Order[] = [];
    snapshot.forEach((doc) => {
      orders.push(doc.data() as Order);
    });

    return NextResponse.json(orders);
  } catch (error: any) {
    console.error('Error fetching orders:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка получения заказов' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { orderId, status, order: clientOrder } = body as {
      orderId: string;
      status: OrderStatus;
      order?: Order;
    };

    if (!orderId || !status) {
      return NextResponse.json({ error: 'orderId и status обязательны' }, { status: 400 });
    }

    let targetOrder: Order | null = clientOrder ? { ...clientOrder, status } : null;

    // 1. Try to update Firestore (best-effort, ignoring permission errors on server)
    try {
      const orderRef = doc(db, 'orders', orderId);
      const snap = await getDoc(orderRef);
      if (snap.exists()) {
        const data = snap.data() as Order;
        targetOrder = { ...data, status };
        await updateDoc(orderRef, {
          status,
          ...(status === 'paid' ? { notificationSent: true } : {}),
        }).catch(() => {});

        if (data.userId) {
          const userOrderRef = doc(db, 'users', data.userId, 'orders', orderId);
          await updateDoc(userOrderRef, {
            status,
            ...(status === 'paid' ? { notificationSent: true } : {}),
          }).catch(() => {});
        }
      }
    } catch (fbErr) {
      console.warn('[Orders PATCH] Firestore access skipped/failed (will proceed with MoySklad & Telegram):', fbErr);
    }

    // 2. Security Check: If client attempts to set status to 'paid', verify with Halyk ePay bank API first!
    if (status === 'paid') {
      const epayCheck = await verifyEpayPayment(orderId);
      if (!epayCheck.paid) {
        console.warn(`[Security Alert] Rejected unverified 'paid' status update for order ${orderId} (Halyk transaction not confirmed)`);
        return NextResponse.json(
          { error: 'Отказано: платёж не подтверждён процессингом банка Halyk ePay' },
          { status: 403 }
        );
      }

      if (targetOrder) {
        if (epayCheck.amount && epayCheck.amount > 0) {
          targetOrder.amount = epayCheck.amount;
        }
        await notifyMoySkladOrderPaid(targetOrder);
      } else {
        // Fallback: construct minimum valid order for invoiceId
        const fallbackOrder: Order = {
          id: orderId,
          invoiceId: orderId,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
          status: 'paid',
          amount: 0,
          itemsPrice: 0,
          deliveryCost: 0,
          deliveryMethod: 'pickup',
          address: 'Адрес из заказа',
          customer: { name: 'Покупатель', phone: '' },
          paymentMethod: 'online',
          items: [],
          notificationSent: true,
        };
        await notifyMoySkladOrderPaid(fallbackOrder);
      }
    }

    return NextResponse.json({ success: true, orderId, status });
  } catch (error: any) {
    console.error('Error updating order status:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка обновления статуса' }, { status: 500 });
  }
}
