import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { verifyStaffSession } from '@/lib/admin-auth';
import { getOrderPickupCode } from '@/lib/pickup-code';

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: RouteContext) {
  try {
    const { id } = await context.params;
    if (!id) {
      return NextResponse.json({ error: 'Не указан ID пользователя' }, { status: 400 });
    }

    // Strict Server-Side Authorization: Only Director and Manager can view user details
    const auth = await verifyStaffSession(request, ['director', 'manager']);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    const decodedId = decodeURIComponent(id).trim();

    // 1. Fetch user by ID or by email
    const users = await client`
      SELECT 
        id, email, full_name, phone, role, is_blocked, blocked_until, created_at, updated_at
      FROM users
      WHERE id = ${decodedId} OR LOWER(email) = LOWER(${decodedId})
      LIMIT 1;
    `;

    let targetUser = users && users.length > 0 ? users[0] : null;

    // If user not in users table yet, check if there are orders for this email/UID
    if (!targetUser) {
      const orderSample = await client`
        SELECT customer_name, customer_email, customer_phone, user_id, created_at
        FROM orders
        WHERE user_id = ${decodedId} OR LOWER(customer_email) = LOWER(${decodedId})
        ORDER BY created_at DESC
        LIMIT 1;
      `;

      if (orderSample && orderSample.length > 0) {
        targetUser = {
          id: orderSample[0].user_id || decodedId,
          email: orderSample[0].customer_email,
          full_name: orderSample[0].customer_name,
          phone: orderSample[0].customer_phone,
          role: 'customer',
          is_blocked: false,
          created_at: orderSample[0].created_at,
          updated_at: orderSample[0].created_at,
        };
      } else {
        return NextResponse.json({ error: 'Пользователь не найден' }, { status: 404 });
      }
    }

    // 2. Fetch all orders for this user (both by user_id and customer_email)
    const userOrders = await client`
      SELECT 
        id, invoice_id, user_id, amount, items_price, delivery_cost,
        delivery_method, payment_method, payment_status, fulfillment_status,
        customer_name, customer_phone, customer_email, kaspi_phone,
        delivery_address, city, items, warehouse_id, completed_at, created_at, updated_at
      FROM orders
      WHERE (user_id = ${targetUser.id} OR LOWER(customer_email) = LOWER(${targetUser.email}))
        AND fulfillment_status != 'deleted'
      ORDER BY created_at DESC;
    `;

    // 3. Attach deterministic pickup codes
    const sanitizedOrders = userOrders.map((o: any) => ({
      ...o,
      pickup_code: getOrderPickupCode(o.id, o.pickup_code || null),
    }));

    // 4. Calculate summary stats
    let totalSpent = 0;
    let activeCount = 0;
    let completedCount = 0;
    let cancelledCount = 0;

    for (const ord of sanitizedOrders) {
      const isCancelled = ord.fulfillment_status === 'cancelled' || ord.payment_status === 'declined' || ord.payment_status === 'cancelled';
      const isCompleted = ord.fulfillment_status === 'completed';

      if (isCancelled) {
        cancelledCount++;
      } else if (isCompleted) {
        completedCount++;
        totalSpent += Number(ord.amount || 0);
      } else {
        activeCount++;
        if (ord.payment_status === 'paid') {
          totalSpent += Number(ord.amount || 0);
        }
      }
    }

    return NextResponse.json({
      success: true,
      user: targetUser,
      orders: sanitizedOrders,
      stats: {
        totalOrders: sanitizedOrders.length,
        activeOrders: activeCount,
        completedOrders: completedCount,
        cancelledOrders: cancelledCount,
        totalSpent,
      },
    });
  } catch (error: any) {
    console.error('[AdminUserDetails Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки данных пользователя' }, { status: 500 });
  }
}
