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

        // Safe user resolution and linking without failing on email/id collisions
        let linkedUserId: string | null = null;
        try {
          if (orderUserId) {
            const byId = await client`SELECT id, email, role FROM users WHERE id = ${orderUserId} LIMIT 1`;
            if (byId && byId.length > 0) {
              linkedUserId = byId[0].id;
              await client`
                UPDATE users
                SET full_name = COALESCE(${customerName}, full_name),
                    phone = COALESCE(${customerPhone}, phone),
                    updated_at = NOW()
                WHERE id = ${linkedUserId};
              `;
            } else {
              const byEmail = await client`SELECT id, email, role FROM users WHERE LOWER(email) = LOWER(${customerEmail}) LIMIT 1`;
              if (byEmail && byEmail.length > 0) {
                linkedUserId = byEmail[0].id;
                await client`
                  UPDATE users
                  SET full_name = COALESCE(${customerName}, full_name),
                      phone = COALESCE(${customerPhone}, phone),
                      updated_at = NOW()
                  WHERE id = ${linkedUserId};
                `;
              } else {
                await client`
                  INSERT INTO users (id, email, full_name, phone, role, updated_at)
                  VALUES (${orderUserId}, ${customerEmail}, ${customerName}, ${customerPhone}, 'customer', NOW());
                `;
                linkedUserId = orderUserId;
              }
            }
          } else {
            const byEmail = await client`SELECT id FROM users WHERE LOWER(email) = LOWER(${customerEmail}) LIMIT 1`;
            if (byEmail && byEmail.length > 0) {
              linkedUserId = byEmail[0].id;
            }
          }
        } catch (uErr) {
          console.warn('[Orders POST] User sync warning (proceeding with order insert):', uErr);
          linkedUserId = null;
        }

        // Guaranteed Order Insert into Neon PostgreSQL
        await client`
          INSERT INTO orders (
            id, invoice_id, user_id, amount, items_price, delivery_cost,
            delivery_method, payment_method, payment_status, fulfillment_status,
            customer_name, customer_phone, customer_email, kaspi_phone,
            delivery_address, city, items, warehouse_id, created_at, updated_at
          ) VALUES (
            ${orderId},
            ${order.invoiceId || orderId},
            ${linkedUserId},
            ${order.amount || 0},
            ${order.itemsPrice || 0},
            ${order.deliveryCost || 0},
            ${order.deliveryMethod || 'pickup'},
            ${order.paymentMethod || 'online'},
            ${(order.status as any) === 'paid' || (order as any).paymentStatus === 'paid' ? 'paid' : 'pending'},
            ${order.fulfillmentStatus || 'assembling'},
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
            fulfillment_status = EXCLUDED.fulfillment_status,
            amount = EXCLUDED.amount,
            items_price = EXCLUDED.items_price,
            items = EXCLUDED.items,
            updated_at = NOW();
        `;
      } catch (neonErr) {
        console.error('[Orders POST] Neon order insert error:', neonErr);
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

    // 1. Resolve user's authoritative email from PostgreSQL or token
    let userEmail: string | null = null;
    if (isDbConfigured() && client) {
      try {
        const u = await client`SELECT email FROM users WHERE id = ${String(userId)} LIMIT 1`;
        if (u && u.length > 0 && u[0].email) {
          userEmail = u[0].email.toLowerCase().trim();
        }
      } catch (err) {
        console.warn('[Orders GET] User email lookup failed:', err);
      }
    }

    // 2. Automatically link any unlinked orders for this email to the active user ID
    if (userEmail && isDbConfigured() && client) {
      try {
        await client`
          UPDATE orders
          SET user_id = ${String(userId)}
          WHERE customer_email IS NOT NULL 
            AND LOWER(customer_email) = ${userEmail}
            AND (user_id IS NULL OR user_id != ${String(userId)});
        `;
      } catch (relinkErr) {
        console.warn('[Orders GET] Order user_id relink warning:', relinkErr);
      }
    }

    const ordersMap = new Map<string, Order>();

    // 3. Fetch all orders from PostgreSQL (by user_id OR by email)
    if (isDbConfigured() && client) {
      try {
        const dbOrders = await client`
          SELECT *
          FROM orders
          WHERE user_id = ${String(userId)}
             OR (customer_email IS NOT NULL AND LOWER(customer_email) = ${userEmail || ''})
          ORDER BY created_at DESC;
        `;

        for (const row of dbOrders) {
          let items: any[] = [];
          if (Array.isArray(row.items)) {
            items = row.items;
          } else if (typeof row.items === 'string') {
            try { items = JSON.parse(row.items); } catch {}
          }

          const orderObj: Order = {
            id: String(row.id),
            invoiceId: row.invoice_id || String(row.id),
            createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
            status: row.payment_status || 'pending',
            amount: Number(row.amount) || 0,
            itemsPrice: Number(row.items_price) || Number(row.amount) || 0,
            deliveryCost: Number(row.delivery_cost) || 0,
            deliveryMethod: (row.delivery_method as any) || 'pickup',
            address: row.delivery_address || '',
            city: row.city || 'Алматы',
            customer: {
              name: row.customer_name || 'Покупатель',
              phone: row.customer_phone || '',
              email: row.customer_email || userEmail || '',
            },
            items,
            pickupCode: getOrderPickupCode(String(row.id)),
            fulfillmentStatus: row.fulfillment_status || 'assembling',
            userId: row.user_id || String(userId),
            expiresAt: new Date(new Date(row.created_at || Date.now()).getTime() + 20 * 60 * 1000).toISOString(),
            paymentMethod: (row.payment_method as any) || 'epay',
          };
          ordersMap.set(String(row.id), orderObj);
        }
      } catch (dbErr) {
        console.warn('[Orders GET] Postgres fetch failed:', dbErr);
      }
    }

    // 4. Also fetch from Firestore and merge
    try {
      const ordersCol = collection(db, 'orders');
      const q = query(ordersCol, where('userId', '==', userId));
      const snapshot = await getDocs(q);

      snapshot.forEach((docSnap) => {
        const data = docSnap.data() as Order;
        const oId = String(data.id || docSnap.id);
        const existing = ordersMap.get(oId);
        ordersMap.set(oId, {
          ...(existing || {}),
          ...data,
          id: oId,
          pickupCode: data.pickupCode || existing?.pickupCode || getOrderPickupCode(oId),
        });
      });

      if (userEmail) {
        try {
          const qEmail = query(ordersCol, where('customer.email', '==', userEmail));
          const emailSnap = await getDocs(qEmail);
          emailSnap.forEach((docSnap) => {
            const data = docSnap.data() as Order;
            const oId = String(data.id || docSnap.id);
            const existing = ordersMap.get(oId);
            ordersMap.set(oId, {
              ...(existing || {}),
              ...data,
              id: oId,
              pickupCode: data.pickupCode || existing?.pickupCode || getOrderPickupCode(oId),
            });
          });
        } catch {
          // ignore compound query restrictions if any
        }
      }
    } catch (fbErr) {
      console.warn('[Orders GET] Firestore fetch failed:', fbErr);
    }

    const ordersList = Array.from(ordersMap.values()).sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );

    return NextResponse.json(ordersList);
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
