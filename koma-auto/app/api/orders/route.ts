import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Order, OrderStatus } from '@/lib/order-types';
import { createMoySkladOrder, notifyMoySkladOrderPaid } from '@/lib/moysklad-order';

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
    const { orderId, status } = body as { orderId: string; status: OrderStatus };

    if (!orderId || !status) {
      return NextResponse.json({ error: 'orderId и status обязательны' }, { status: 400 });
    }

    try {
      const orderRef = doc(db, 'orders', orderId);
      const snap = await getDoc(orderRef);
      if (snap.exists()) {
        const data = snap.data() as Order;
        const updatedOrder: Order = { ...data, status };

        if (status === 'paid' && !data.notificationSent) {
          await updateDoc(orderRef, { status: 'paid', notificationSent: true });
          if (data.userId) {
            const userOrderRef = doc(db, 'users', data.userId, 'orders', orderId);
            await updateDoc(userOrderRef, { status: 'paid', notificationSent: true }).catch(() => {});
          }
          // Send push notifications (MoySklad Task + Telegram)
          await notifyMoySkladOrderPaid(updatedOrder);
        } else {
          await updateDoc(orderRef, { status });
          if (data.userId) {
            const userOrderRef = doc(db, 'users', data.userId, 'orders', orderId);
            await updateDoc(userOrderRef, { status }).catch(() => {});
          }
        }
      }
    } catch (fbErr) {
      console.warn('Firestore update order status warning:', fbErr);
    }

    return NextResponse.json({ success: true, orderId, status });
  } catch (error: any) {
    console.error('Error updating order status:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка обновления статуса' }, { status: 500 });
  }
}
