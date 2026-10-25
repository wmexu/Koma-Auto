import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Order, OrderStatus } from '@/lib/order-types';
import { createMoySkladOrder, notifyMoySkladOrderPaid, markMoySkladOrderCancelled } from '@/lib/moysklad-order';
import { verifyEpayPayment } from '@/lib/epay-refund';
import { client, isDbConfigured } from '@/db';
import { verifyStaffSession, getVerifiedCallerUid } from '@/lib/admin-auth';
import { isKillSwitchActive } from '@/lib/system-settings';
import { getOrderPickupCode } from '@/lib/pickup-code';

export async function POST(request: Request) {
  try {
    // 0. Emergency Kill-Switch Check
    const killSwitch = await isKillSwitchActive();
    if (killSwitch) {
      return NextResponse.json(
        { error: 'Приём заказов на сайте временно приостановлен администрацией магазина.' },
        { status: 503 }
      );
    }

    const order = (await request.json()) as Order;

    if (!order || !order.id) {
      return NextResponse.json({ error: 'Некорректные данные заказа' }, { status: 400 });
    }

    // Strict Financial Security: On creation, orders MUST ALWAYS have status 'pending'
    // A client can never inject or bypass payment by sending { status: 'paid' }
    order.status = 'pending';
    order.notificationSent = false;
    order.pickupCode = getOrderPickupCode(order.id, order.pickupCode);

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

    // 3. Mirror order & customer to Neon PostgreSQL for staff CRM
    if (isDbConfigured() && client) {
      try {
        const orderId = String(order.id);
        const orderUserId = order.userId || order.userAccountDetails?.uid || null;
        const customerEmail = (order.customer?.email || order.userAccountDetails?.email || `customer_${orderId}@koma.kz`).toLowerCase().trim();
        const customerName = order.customer?.name || order.userAccountDetails?.displayName || 'Покупатель';
        const customerPhone = order.customer?.phone || '';

        // Upsert user in Neon if userId is available
        if (orderUserId) {
          await client`
            INSERT INTO users (id, email, full_name, phone, role, updated_at)
            VALUES (${orderUserId}, ${customerEmail}, ${customerName}, ${customerPhone}, 'customer', NOW())
            ON CONFLICT (id) DO UPDATE SET
              full_name = COALESCE(EXCLUDED.full_name, users.full_name),
              phone = COALESCE(EXCLUDED.phone, users.phone),
              updated_at = NOW();
          `;
        }

        // Insert order into Neon
        await client`
          INSERT INTO orders (
            id, invoice_id, user_id, amount, items_price, delivery_cost,
            delivery_method, payment_method, payment_status, fulfillment_status,
            customer_name, customer_phone, customer_email, kaspi_phone,
            delivery_address, city, items, warehouse_id, created_at, updated_at
          ) VALUES (
            ${orderId},
            ${order.invoiceId || orderId},
            ${orderUserId},
            ${order.amount || 0},
            ${order.itemsPrice || 0},
            ${order.deliveryCost || 0},
            ${order.deliveryMethod || 'pickup'},
            ${order.paymentMethod || 'online'},
            'pending',
            'assembling',
            ${customerName},
            ${customerPhone},
            ${customerEmail},
            ${order.kaspiPhone || null},
            ${order.address || ''},
            ${order.city || 'Алматы'},
            ${JSON.stringify(order.items || [])}::jsonb,
            'car_city_podval',
            ${order.createdAt ? new Date(order.createdAt) : new Date()},
            NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            payment_status = EXCLUDED.payment_status,
            amount = EXCLUDED.amount,
            updated_at = NOW();
        `;
      } catch (neonErr) {
        console.warn('Neon order mirror notice (non-fatal):', neonErr);
      }
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
      const orderData = docSnap.data() as Order;

      // Require staff session or verified order owner
      const staffAuth = await verifyStaffSession(request, ['courier', 'manager', 'director']);
      const verifiedUid = await getVerifiedCallerUid(request);
      const isOwner = Boolean(orderData.userId && verifiedUid && orderData.userId === verifiedUid);

      if (!staffAuth.authorized && !isOwner) {
        return NextResponse.json(
          { error: 'Доступ ограничен: требуются права администратора или владельца заказа' },
          { status: 403 }
        );
      }

      return NextResponse.json({
        ...orderData,
        pickupCode: orderData.pickupCode || getOrderPickupCode(orderData.id),
      });
    }

    if (!userId) {
      return NextResponse.json({ error: 'Параметр userId обязателен' }, { status: 400 });
    }

    // Zero-Trust: Caller must cryptographically prove ownership of this userId OR be authorized staff
    const verifiedUid = await getVerifiedCallerUid(request);
    let isOwnerOrStaff = Boolean(verifiedUid && verifiedUid === userId);

    if (!isOwnerOrStaff) {
      const staffAuth = await verifyStaffSession(request, ['courier', 'manager', 'director']);
      isOwnerOrStaff = staffAuth.authorized;
    }

    if (!isOwnerOrStaff) {
      return NextResponse.json({ error: 'Доступ запрещен: просмотр чужих заказов ограничен' }, { status: 403 });
    }

    const ordersCol = collection(db, 'orders');
    const q = query(ordersCol, where('userId', '==', userId));
    const snapshot = await getDocs(q);

    const orders: Order[] = [];
    snapshot.forEach((doc) => {
      const data = doc.data() as Order;
      orders.push({
        ...data,
        pickupCode: data.pickupCode || getOrderPickupCode(data.id),
      });
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

    // Fetch existing order from Firestore (or fallback from clientOrder)
    let targetOrder: Order | null = clientOrder ? { ...clientOrder, id: orderId } : null;
    try {
      const orderRef = doc(db, 'orders', orderId);
      const snap = await getDoc(orderRef);
      if (snap.exists()) {
        targetOrder = snap.data() as Order;
      }
    } catch (fbErr) {
      console.warn('[Orders PATCH] Firestore read failed:', fbErr);
    }

    // STRICT ZERO-TRUST SECURITY GATE:
    // Only two status transitions are permitted via this endpoint:
    // 1. 'paid' -> MUST be verified directly against Halyk Bank ePay processing API!
    // 2. 'declined' -> MUST be authorized by verified staff or verified order owner!
    // Any other status change (e.g. 'in_assembly', 'ready', 'picked_up') MUST go through /api/admin/orders or /api/orders/verify-pickup!
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
        const fallbackOrder: Order = {
          id: orderId,
          invoiceId: orderId,
          createdAt: new Date().toISOString(),
          expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
          status: 'paid',
          amount: epayCheck.amount || 0,
          itemsPrice: epayCheck.amount || 0,
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
    } else if (status === 'declined') {
      const staffAuth = await verifyStaffSession(request, ['director', 'manager']);
      const verifiedUid = await getVerifiedCallerUid(request);
      const isOwner = Boolean(targetOrder?.userId && verifiedUid && targetOrder.userId === verifiedUid);

      if (!staffAuth.authorized && !isOwner) {
        return NextResponse.json(
          { error: 'Отказано: отменять заказ могут только уполномоченные сотрудники или владелец заказа' },
          { status: 403 }
        );
      }

      try {
        await markMoySkladOrderCancelled(orderId, 'Оплата не прошла или заказ отклонен');
      } catch (e) {
        console.warn('Failed to mark MoySklad order as cancelled:', e);
      }
    } else {
      return NextResponse.json(
        { error: 'Недопустимый переход статуса через публичный интерфейс. Используйте служебный терминал.' },
        { status: 403 }
      );
    }

    // ONLY NOW — after all cryptographic & bank verification checks have succeeded — update Firestore!
    try {
      const orderRef = doc(db, 'orders', orderId);
      await updateDoc(orderRef, {
        status,
        ...(status === 'paid' ? { notificationSent: true } : {}),
      }).catch(() => {});

      if (targetOrder?.userId) {
        const userOrderRef = doc(db, 'users', targetOrder.userId, 'orders', orderId);
        await updateDoc(userOrderRef, {
          status,
          ...(status === 'paid' ? { notificationSent: true } : {}),
        }).catch(() => {});
      }
    } catch (fbErr) {
      console.warn('[Orders PATCH] Firestore access skipped/failed:', fbErr);
    }

    // Mirror status to Neon DB
    if (isDbConfigured() && client) {
      try {
        await client`
          UPDATE orders
          SET payment_status = ${status === 'paid' ? 'paid' : status === 'declined' ? 'failed' : 'pending'},
              updated_at = NOW()
          WHERE id = ${orderId} OR invoice_id = ${orderId};
        `;
      } catch (neonErr) {
        console.warn('Neon order status sync notice:', neonErr);
      }
    }

    return NextResponse.json({ success: true, orderId, status });
  } catch (error: any) {
    console.error('Error updating order status:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка обновления статуса' }, { status: 500 });
  }
}
