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
    const orderId = searchParams.get('orderId');
    const period = searchParams.get('period') || '30'; // 30, 60, 360, all
    const status = searchParams.get('status');
    const includeDeleted = searchParams.get('includeDeleted') === 'true';

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    // Direct single order lookup for CRM Order Details page
    if (orderId) {
      const rows = await client`
        SELECT 
          id, invoice_id, user_id, amount, items_price, delivery_cost,
          delivery_method, payment_method, payment_status, fulfillment_status,
          assigned_courier_id, customer_name, customer_phone, customer_email,
          kaspi_phone, delivery_address, city, items, warehouse_id,
          completed_at, created_at, updated_at
        FROM orders
        WHERE id = ${orderId} OR invoice_id = ${orderId}
        LIMIT 1;
      `;

      if (!rows || rows.length === 0) {
        return NextResponse.json({ error: 'Заказ не найден' }, { status: 404 });
      }

      const ord = rows[0];
      if (auth.user.role === 'courier' && ord.assigned_courier_id !== auth.user.id) {
        return NextResponse.json({ error: 'Доступ к чужому заказу ограничен' }, { status: 403 });
      }

      return NextResponse.json({
        success: true,
        order: {
          ...ord,
          pickup_code: getOrderPickupCode(ord.id, ord.pickup_code || null),
        },
      });
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
        WHERE assigned_courier_id = ${auth.user.id} AND fulfillment_status != 'deleted'
        ORDER BY created_at DESC;
      `;
    } else {
      // Manager / Director sees all orders with period filter
      if (status === 'deleted') {
        ordersList = await client`
          SELECT 
            id, invoice_id, user_id, amount, items_price, delivery_cost,
            delivery_method, payment_method, payment_status, fulfillment_status,
            assigned_courier_id, customer_name, customer_phone, customer_email,
            kaspi_phone, delivery_address, city, items, warehouse_id,
            completed_at, created_at, updated_at
          FROM orders
          WHERE fulfillment_status = 'deleted'
          ORDER BY updated_at DESC;
        `;
      } else if (isAllTime) {
        if (includeDeleted) {
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
            WHERE fulfillment_status != 'deleted'
            ORDER BY created_at DESC;
          `;
        }
      } else {
        if (includeDeleted) {
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
              AND fulfillment_status != 'deleted'
            ORDER BY created_at DESC;
          `;
        }
      }
    }

    // Filter by specific status if requested and not 'deleted' (already handled above)
    if (status && status !== 'all' && status !== 'deleted') {
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
    if (!auth.authorized || !auth.user) {
      return NextResponse.json({ error: auth.error || 'Unauthorized' }, { status: auth.status || 401 });
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
            WHEN fulfillment_status = 'assembling' THEN 'out_for_delivery'
            ELSE fulfillment_status
          END,
          updated_at = NOW()
        WHERE id = ${String(orderId)};
      `;

      logAuditEvent({
        userId: auth.user.id,
        action: 'ORDER_ASSIGNED',
        entityType: 'order',
        entityId: String(orderId),
        details: { courierId, courierName },
      });

      return NextResponse.json({ success: true, message: `Заказ успешно передан курьеру ${courierName || ''}` });
    }

    if (action === 'cancel_order') {
      const reason = body.reason || 'Отменен менеджером';

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

      // Sync Firestore so client immediately sees "Отменен менеджером"
      try {
        const orderRef = doc(db, 'orders', String(orderId));
        await updateDoc(orderRef, {
          status: 'declined',
          fulfillmentStatus: 'cancelled',
          cancelledBy: 'staff',
          cancelledAt: new Date().toISOString(),
          cancellationReason: reason,
          customStatusText: 'Отменен менеджером',
        });
      } catch (fsErr) {
        console.warn('[AdminOrders] Firestore cancel sync warning:', fsErr);
      }

      logAuditEvent({
        userId: auth.user.id,
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'order',
        entityId: String(orderId),
        details: { action: 'ORDER_CANCELLED_BY_STAFF', reason },
      });

      return NextResponse.json({
        success: true,
        message: 'Заказ успешно отклонен менеджером',
      });
    }

    if (action === 'archive_order') {
      await client`
        UPDATE orders
        SET 
          fulfillment_status = 'completed',
          updated_at = NOW()
        WHERE id = ${String(orderId)};
      `;

      try {
        const orderRef = doc(db, 'orders', String(orderId));
        await updateDoc(orderRef, {
          fulfillmentStatus: 'completed',
          customStatusText: 'Выдан',
        });
      } catch (fsErr) {
        console.warn('[AdminOrders] Firestore archive sync warning:', fsErr);
      }

      logAuditEvent({
        userId: auth.user.id,
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'order',
        entityId: String(orderId),
        details: { action: 'ORDER_ARCHIVED' },
      });

      return NextResponse.json({
        success: true,
        message: 'Заказ перемещен в архив',
      });
    }

    if (action === 'restore_to_active') {
      await client`
        UPDATE orders
        SET 
          fulfillment_status = 'assembling',
          updated_at = NOW()
        WHERE id = ${String(orderId)};
      `;

      try {
        const orderRef = doc(db, 'orders', String(orderId));
        await updateDoc(orderRef, {
          fulfillmentStatus: 'assembling',
          customStatusText: 'На складе',
        });
      } catch (fsErr) {
        console.warn('[AdminOrders] Firestore restore sync warning:', fsErr);
      }

      logAuditEvent({
        userId: auth.user.id,
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'order',
        entityId: String(orderId),
        details: { action: 'ORDER_RESTORED_TO_ACTIVE' },
      });

      return NextResponse.json({
        success: true,
        message: 'Заказ успешно возвращен в активные заказы',
      });
    }

    if (action === 'move_to_deleted') {
      await client`
        UPDATE orders
        SET 
          fulfillment_status = 'deleted',
          updated_at = NOW()
        WHERE id = ${String(orderId)};
      `;

      try {
        const orderRef = doc(db, 'orders', String(orderId));
        await updateDoc(orderRef, {
          fulfillmentStatus: 'deleted',
        });
      } catch (fsErr) {
        console.warn('[AdminOrders] Firestore delete sync warning:', fsErr);
      }

      logAuditEvent({
        userId: auth.user.id,
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'order',
        entityId: String(orderId),
        details: { action: 'ORDER_MOVED_TO_DELETED' },
      });

      return NextResponse.json({
        success: true,
        message: 'Заказ перемещен в удаленные',
      });
    }

    if (action === 'change_status' || action === 'change_fulfillment_status') {
      if (!status) {
        return NextResponse.json({ error: 'Укажите новый статус' }, { status: 400 });
      }

      const validStatuses = ['assembling', 'packaging', 'out_for_delivery', 'delivered', 'completed', 'cancelled'];
      if (!validStatuses.includes(status)) {
        return NextResponse.json({ error: 'Недопустимый статус заказа' }, { status: 400 });
      }

      const statusLabels: Record<string, string> = {
        assembling: 'На складе',
        packaging: 'Упаковывается',
        out_for_delivery: 'Передан в доставку',
        delivered: 'Доставлен по адресу',
        completed: 'Выдан',
        cancelled: 'Отменен менеджером',
      };
      const customStatusText = statusLabels[status] || status;

      await client`
        UPDATE orders
        SET 
          fulfillment_status = ${status},
          updated_at = NOW()
        WHERE id = ${String(orderId)};
      `;

      try {
        const orderRef = doc(db, 'orders', String(orderId));
        await updateDoc(orderRef, {
          fulfillmentStatus: status,
          customStatusText,
          updatedAt: new Date().toISOString(),
        });
      } catch (fsErr) {
        console.warn('[AdminOrders] Firestore status sync notice:', fsErr);
      }

      logAuditEvent({
        userId: auth.user.id,
        action: 'ORDER_STATUS_CHANGED',
        entityType: 'order',
        entityId: String(orderId),
        details: { newStatus: status, customStatusText },
      });

      return NextResponse.json({ success: true, message: `Статус заказа изменен на "${customStatusText}"` });
    }

    return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
  } catch (error: any) {
    console.error('[AdminOrders PATCH Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка обновления заказа' }, { status: 500 });
  }
}
