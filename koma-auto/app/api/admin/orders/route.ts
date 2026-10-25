import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { logAuditEvent } from '@/lib/audit';
import { verifyStaffSession } from '@/lib/admin-auth';
import { getOrderPickupCode } from '@/lib/pickup-code';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

export async function GET(request: Request) {
  try {
    // 1. Strict Server-Side Authorization: Courier, Manager, or Director
    const auth = await verifyStaffSession(request, ['courier', 'manager', 'director']);
    if (!auth.authorized || !auth.user) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '30'; // 30, 60, 360, all
    const status = searchParams.get('status');

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    let intervalDays = 30;
    if (period === '60') intervalDays = 60;
    if (period === '360') intervalDays = 360;
    const isAllTime = period === 'all';

    let ordersList: any[] = [];

    // Courier can ONLY EVER see their own assigned orders (enforced by server from authenticated user.id)
    if (auth.user.role === 'courier') {
      ordersList = await client`
        SELECT 
          id, invoice_id, user_id, amount, items_price, delivery_cost,
          delivery_method, payment_method, payment_status, fulfillment_status,
          assigned_courier_id, customer_name, customer_phone, customer_email,
          kaspi_phone, delivery_address, city, items, warehouse_id,
          completed_at, created_at, updated_at
        FROM orders
        WHERE assigned_courier_id = ${auth.user.id}
        ORDER BY created_at DESC;
      `;
    } else {
      // Manager / Director sees all orders with period filter
      if (isAllTime) {
        ordersList = await client`
          SELECT 
            id, invoice_id, user_id, amount, items_price, delivery_cost,
            delivery_method, payment_method, payment_status, fulfillment_status,
            assigned_courier_id, customer_name, customer_phone, customer_email,
            kaspi_phone, delivery_address, city, items, warehouse_id,
            completed_at, created_at, updated_at
          FROM orders
          ORDER BY created_at DESC;
        `;
      } else {
        ordersList = await client`
          SELECT 
            id, invoice_id, user_id, amount, items_price, delivery_cost,
            delivery_method, payment_method, payment_status, fulfillment_status,
            assigned_courier_id, customer_name, customer_phone, customer_email,
            kaspi_phone, delivery_address, city, items, warehouse_id,
            completed_at, created_at, updated_at
          FROM orders
          WHERE created_at >= NOW() - (${intervalDays} || ' days')::INTERVAL
          ORDER BY created_at DESC;
        `;
      }
    }

    // Filter by status if requested
    if (status && status !== 'all') {
      ordersList = ordersList.filter(o => o.fulfillment_status === status);
    }

    // Attach deterministic pickup code for authorized staff
    const sanitizedOrders = ordersList.map((order: any) => ({
      ...order,
      pickup_code: getOrderPickupCode(order.id, order.pickup_code || null),
    }));

    return NextResponse.json({ success: true, count: sanitizedOrders.length, orders: sanitizedOrders });
  } catch (error: any) {
    console.error('[AdminOrders Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки заказов' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { action, orderId, courierId, courierName, status, staffUserId } = body;

    // Strict Server-Side Authorization: Only Managers and Directors can reassign or modify orders
    const auth = await verifyStaffSession(request, ['manager', 'director'], staffUserId);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!orderId || !action) {
      return NextResponse.json({ error: 'Некорректные параметры' }, { status: 400 });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    if (action === 'assign_courier') {
      if (!courierId) {
        return NextResponse.json({ error: 'Выберите курьера' }, { status: 400 });
      }

      await client`
        UPDATE orders
        SET 
          assigned_courier_id = ${courierId},
          fulfillment_status = CASE 
            WHEN fulfillment_status = 'assembling' THEN 'out_for_delivery'::order_fulfillment_status
            ELSE fulfillment_status
          END,
          updated_at = NOW()
        WHERE id = ${String(orderId)};
      `;

      logAuditEvent({
        userId: staffUserId || null,
        action: 'ORDER_ASSIGNED',
        entityType: 'order',
        entityId: String(orderId),
        details: { courierId, courierName },
      });

      return NextResponse.json({ success: true, message: `Заказ успешно передан курьеру ${courierName || ''}` });
    }

    if (action === 'cancel_order' || action === 'archive_order') {
      const isCancel = action === 'cancel_order';
      const reason = body.reason || (isCancel ? 'Отменен администратором в CRM' : 'Перенесен в архив');

      await client`
        UPDATE orders
        SET 
          fulfillment_status = 'cancelled',
          payment_status = CASE 
            WHEN payment_status = 'pending' THEN 'cancelled'
            ELSE payment_status
          END,
          updated_at = NOW()
        WHERE id = ${String(orderId)};
      `;

      // Sync Firestore
      try {
        const orderRef = doc(db, 'orders', String(orderId));
        await updateDoc(orderRef, {
          status: 'declined',
          fulfillmentStatus: 'cancelled',
          cancelledBy: 'admin',
          cancelledAt: new Date().toISOString(),
          cancellationReason: reason,
        });
      } catch (fsErr) {
        console.warn('[AdminOrders] Firestore cancel sync warning:', fsErr);
      }

      logAuditEvent({
        userId: staffUserId || null,
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'order',
        entityId: String(orderId),
        details: { action: isCancel ? 'ORDER_CANCELLED' : 'ORDER_ARCHIVED', reason },
      });

      return NextResponse.json({
        success: true,
        message: isCancel ? 'Заказ успешно отклонен и перемещен в архив' : 'Заказ перемещен в архив',
      });
    }

    if (action === 'change_status') {
      if (!status) {
        return NextResponse.json({ error: 'Укажите новый статус' }, { status: 400 });
      }

      await client`
        UPDATE orders
        SET 
          fulfillment_status = ${status},
          updated_at = NOW()
        WHERE id = ${String(orderId)};
      `;

      logAuditEvent({
        userId: staffUserId || null,
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'order',
        entityId: String(orderId),
        details: { newStatus: status },
      });

      return NextResponse.json({ success: true, message: 'Статус заказа обновлен' });
    }

    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
  } catch (error: any) {
    console.error('[AdminOrders PATCH Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка обновления заказа' }, { status: 500 });
  }
}
