import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { logAuditEvent } from '@/lib/audit';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get('period') || '30'; // 30, 60, 360, all
    const role = searchParams.get('role') || 'manager';
    const userId = searchParams.get('userId');
    const status = searchParams.get('status');

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    let intervalDays = 30;
    if (period === '60') intervalDays = 60;
    if (period === '360') intervalDays = 360;
    const isAllTime = period === 'all';

    let ordersList: any[] = [];

    if (role === 'courier' && userId) {
      // Courier only sees their assigned orders
      ordersList = await client`
        SELECT 
          id, invoice_id, user_id, amount, items_price, delivery_cost,
          delivery_method, payment_method, payment_status, fulfillment_status,
          assigned_courier_id, customer_name, customer_phone, customer_email,
          kaspi_phone, delivery_address, city, items, warehouse_id,
          completed_at, created_at, updated_at
        FROM orders
        WHERE assigned_courier_id = ${userId}
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

    return NextResponse.json({ success: true, count: ordersList.length, orders: ordersList });
  } catch (error: any) {
    console.error('[AdminOrders Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки заказов' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = await request.json();
    const { action, orderId, courierId, courierName, status, staffUserId } = body;

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
