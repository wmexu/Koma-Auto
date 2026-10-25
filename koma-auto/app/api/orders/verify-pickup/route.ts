import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { verifyPickupCode } from '@/lib/crypto-security';
import { checkRateLimit, recordFailedAttempt, resetRateLimit } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';

export async function POST(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown-ip';
    const rateCheck = checkRateLimit(ip);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Слишком много попыток. Попробуйте через ${rateCheck.remainingSeconds || 900} сек.` },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { orderId, code, staffUserId } = body;

    if (!orderId || !code) {
      return NextResponse.json({ error: 'Укажите номер заказа и 12-значный код получения' }, { status: 400 });
    }

    const cleanCode = String(code).replace(/\D/g, '');
    if (cleanCode.length !== 12) {
      return NextResponse.json({ error: 'Код получения должен состоять ровно из 12 цифр' }, { status: 400 });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    // Atomic transaction with pessimistic row lock (SELECT FOR UPDATE)
    const result = await client.begin(async (sql) => {
      // 1. Lock the row
      const rows = await sql`
        SELECT id, fulfillment_status, pickup_code_hash, pickup_code_salt, customer_name, amount
        FROM orders
        WHERE id = ${String(orderId)}
        FOR UPDATE;
      `;

      if (!rows || rows.length === 0) {
        return { success: false, status: 404, error: 'Заказ с таким номером не найден' };
      }

      const order = rows[0];

      // 2. Check if already completed
      if (order.fulfillment_status === 'completed') {
        return { success: false, status: 400, error: 'Заказ уже был выдан и завершен ранее' };
      }

      // 3. Verify code
      if (!order.pickup_code_hash || !order.pickup_code_salt) {
        return { success: false, status: 400, error: 'Для данного заказа не сформирован код получения' };
      }

      const isValid = verifyPickupCode(cleanCode, order.pickup_code_salt, order.pickup_code_hash);

      if (!isValid) {
        recordFailedAttempt(ip);
        return { success: false, status: 400, error: 'Неверный код получения' };
      }

      // 4. Update order status atomically
      await sql`
        UPDATE orders
        SET 
          fulfillment_status = 'completed',
          completed_at = NOW(),
          completed_by_user_id = ${staffUserId || null},
          updated_at = NOW()
        WHERE id = ${String(orderId)};
      `;

      // 5. Log audit
      await sql`
        INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (
          gen_random_uuid(),
          ${staffUserId || null},
          'ORDER_COMPLETED',
          'order',
          ${String(orderId)},
          ${JSON.stringify({ orderId, customer: order.customer_name, amount: order.amount })}::jsonb,
          ${ip},
          NOW()
        );
      `;

      resetRateLimit(ip);
      return { success: true, status: 200, message: 'Заказ успешно верифицирован и выдан клиенту!' };
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    return NextResponse.json({ success: true, message: result.message });
  } catch (error: any) {
    console.error('[VerifyPickup Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка верификации заказа' }, { status: 500 });
  }
}
