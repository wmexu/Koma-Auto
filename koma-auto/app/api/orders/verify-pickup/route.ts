import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { verifyPickupCode } from '@/lib/crypto-security';
import { getOrderPickupCode } from '@/lib/pickup-code';
import { checkRateLimit, recordFailedAttempt, resetRateLimit } from '@/lib/rate-limiter';
import { logAuditEvent } from '@/lib/audit';
import { verifyStaffSession } from '@/lib/admin-auth';
import { db } from '@/lib/firebase';
import { doc, updateDoc } from 'firebase/firestore';

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
    const { orderId, code, staffUserId, confirmMatch } = body;

    // Strict Server-Side Authorization: Only verified Staff members can complete orders
    const auth = await verifyStaffSession(request, ['courier', 'manager', 'director'], staffUserId);
    if (!auth.authorized || !auth.user) {
      return NextResponse.json(
        { error: 'Отказано: верификация заказов доступна только действующим сотрудникам (курьер, менеджер, директор)' },
        { status: 403 }
      );
    }

    const staffUser = auth.user;

    if (!orderId) {
      return NextResponse.json({ error: 'Укажите номер заказа' }, { status: 400 });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    // Atomic transaction with pessimistic row lock (SELECT FOR UPDATE)
    const result = await client.begin(async (sql) => {
      // 1. Lock the row
      const rows = await sql`
        SELECT id, fulfillment_status, pickup_code_hash, pickup_code_salt, customer_name, amount, assigned_courier_id
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

      // Check if courier is assigned to this order
      if (staffUser.role === 'courier' && order.assigned_courier_id && order.assigned_courier_id !== staffUser.id) {
        return { success: false, status: 403, error: 'Этот заказ закреплен за другим курьером' };
      }

      // 3. Verify code or visual match confirmation
      const expectedCode = getOrderPickupCode(String(orderId));
      if (code) {
        const cleanCode = String(code).replace(/\D/g, '');
        let codeMatches = cleanCode === expectedCode;
        if (!codeMatches && order.pickup_code_salt && order.pickup_code_hash) {
          codeMatches = verifyPickupCode(cleanCode, order.pickup_code_salt, order.pickup_code_hash);
        }
        if (!codeMatches) {
          recordFailedAttempt(ip);
          return { success: false, status: 400, error: 'Неверный код получения' };
        }
      } else if (!confirmMatch) {
        return { success: false, status: 400, error: 'Подтвердите сверку кода получения' };
      }

      // 4. Update order status atomically
      await sql`
        UPDATE orders
        SET 
          fulfillment_status = 'completed',
          completed_at = NOW(),
          completed_by_user_id = ${staffUserId || staffUser.id},
          updated_at = NOW()
        WHERE id = ${String(orderId)};
      `;

      // 5. Log audit
      await sql`
        INSERT INTO audit_logs (id, user_id, action, entity_type, entity_id, details, ip_address, created_at)
        VALUES (
          gen_random_uuid(),
          ${staffUserId || staffUser.id},
          'ORDER_COMPLETED',
          'order',
          ${String(orderId)},
          ${JSON.stringify({
            orderId: String(orderId),
            verifiedBy: staffUser.email,
            role: staffUser.role,
            customer: order.customer_name,
            amount: order.amount,
            method: code ? 'typed_code' : 'visual_match',
          })}::jsonb,
          ${ip},
          NOW()
        );
      `;

      resetRateLimit(ip);
      return { success: true, status: 200, message: 'Заказ успешно выдан клиенту!' };
    });

    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }

    // Sync status with Firestore (best effort)
    try {
      const orderRef = doc(db, 'orders', String(orderId));
      await updateDoc(orderRef, {
        fulfillmentStatus: 'completed',
        completedAt: new Date().toISOString(),
        completedByUserId: staffUserId || staffUser.id,
      });
    } catch (fsErr) {
      console.warn('[VerifyPickup] Firestore sync warning:', fsErr);
    }

    return NextResponse.json({ success: true, message: result.message });
  } catch (error: any) {
    console.error('[VerifyPickup Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка верификации заказа' }, { status: 500 });
  }
}
