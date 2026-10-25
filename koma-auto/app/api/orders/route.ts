import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Order, OrderStatus } from '@/lib/order-types';
import { createMoySkladOrder, notifyMoySkladOrderPaid, markMoySkladOrderCancelled } from '@/lib/moysklad-order';
import { verifyEpayPayment } from '@/lib/epay-refund';
import { client, isDbConfigured } from '@/db';
import { verifyStaffSession } from '@/lib/admin-auth';
import { isKillSwitchActive } from '@/lib/system-settings';

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
      // Require staff or admin authorization for direct lookup of customer order data by ID
      const authHeader = request.headers.get('authorization');
      const customKey = request.headers.get('x-admin-key');
      const adminKey = process.env.ADMIN_SECRET_KEY;
      const providedKey = customKey || (authHeader?.startsWith('Bearer ') ? authHeader.slice(7).trim() : null);

      let isAuthorized = Boolean(adminKey && providedKey === adminKey);
      if (!isAuthorized) {
        const staffAuth = await verifyStaffSession(request, ['courier', 'manager', 'director']);
        isAuthorized = staffAuth.authorized;
      }

      if (!isAuthorized) {
        return NextResponse.json({ error: 'Доступ ограничен: требуются права администратора или сотрудника' }, { status: 403 });
      }

      const docSnap = await getDoc(doc(db, 'orders', orderId));
      if (!docSnap.exists()) {
        return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
      }
      return NextResponse.json(docSnap.data());
    }

    if (!userId) {
      return NextResponse.json({ error: 'Параметр userId обязателен' }, { status: 400 });
    }

    // Verify caller ownership or staff permissions
    const reqUserId = request.headers.get('x-user-id');
    const staffId = request.headers.get('x-staff-user-id');
    let isOwnerOrStaff = Boolean(reqUserId && reqUserId === userId);

    if (!isOwnerOrStaff && (staffId || request.headers.get('authorization'))) {
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

    // 2. Security Check: If client attempts to set status to 'declined', verify authority
    if (status === 'declined') {
      const staffAuth = await verifyStaffSession(request, ['director', 'manager']);
      const reqUserId = request.headers.get('x-user-id') || request.headers.get('x-staff-user-id');
      const isOwner = Boolean(targetOrder?.userId && reqUserId && targetOrder.userId === reqUserId);

      if (!staffAuth.authorized && !isOwner) {
        return NextResponse.json(
          { error: 'Отказано: отменять заказ могут только уполномоченные сотрудники или владелец заказа' },
          { status: 403 }
        );
      }

      try {
        await markMoySkladOrderCancelled(orderId, 'Оплата не прошла');
      } catch (e) {
        console.warn('Failed to mark MoySklad order as cancelled:', e);
      }
    }

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

    // 3. Mirror status to Neon DB
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
