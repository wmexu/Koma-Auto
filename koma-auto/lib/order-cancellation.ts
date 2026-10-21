import { db } from './firebase';
import { doc, getDoc, updateDoc, collection, query, where, getDocs } from 'firebase/firestore';
import { Order } from './order-types';
import { refundEpayPayment, EpayRefundResult } from './epay-refund';

const API_URL = process.env.MOYSKLAD_API_URL || 'https://api.moysklad.ru/api/remap/1.2';
const TOKEN = process.env.MOYSKLAD_TOKEN;
const STATE_CANCELLED_HREF =
  'https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/79219399-4aa7-11f1-0a80-1ac70019f4f5';
const ORGANIZATION_HREF =
  'https://api.moysklad.ru/api/remap/1.2/entity/organization/7909a58f-4aa7-11f1-0a80-1ac70019f4ae';

export interface CancelOrderResult {
  success: boolean;
  orderId: string;
  order?: Order;
  refundResult?: EpayRefundResult;
  message: string;
  error?: string;
}

function getMoySkladHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip',
  };
}

/**
 * Finds order in Firestore by orderId, invoiceId, or MoySklad name
 */
async function findFirestoreOrder(identifier: string): Promise<{ ref: any; data: Order } | null> {
  const cleanId = identifier.replace(/^№\s*/, '').trim();

  // 1. Direct doc lookup
  const directRef = doc(db, 'orders', cleanId);
  const directSnap = await getDoc(directRef);
  if (directSnap.exists()) {
    return { ref: directRef, data: directSnap.data() as Order };
  }

  // 2. Query by invoiceId
  try {
    const ordersCol = collection(db, 'orders');
    const qInvoice = query(ordersCol, where('invoiceId', '==', cleanId));
    const snapInvoice = await getDocs(qInvoice);
    if (!snapInvoice.empty) {
      const docSnap = snapInvoice.docs[0];
      return { ref: docSnap.ref, data: docSnap.data() as Order };
    }
  } catch (e) {
    console.warn('[Order Search] Invoice query error:', e);
  }

  return null;
}

/**
 * Sends order cancellation notification to Telegram channel
 */
async function notifyTelegramCancellation(order: Order, reason: string, refundResult?: EpayRefundResult) {
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = process.env.TELEGRAM_CHAT_ID;
  if (!tgToken || !tgChatId) return;

  const nowAlmaty = new Date().toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' });
  const refundStatusStr = refundResult?.success
    ? `Успешно отправлен в ePay (${order.amount.toLocaleString('ru-RU')} ₸)`
    : (refundResult?.message || 'Не требуется (заказ не был оплачен)');

  const text = `ОТМЕНА ЗАКАЗА №${order.id}

Статус: Отклонен (Отменен администратором)
Клиент: ${order.customer.name}, тел: ${order.customer.phone}
Сумма заказа: ${order.amount.toLocaleString('ru-RU')} ₸
Причина отмены: ${reason}
Возврат Halyk ePay: ${refundStatusStr}
Срок зачисления: 1–5 рабочих дней на карту покупателя
Дата и время: ${nowAlmaty}`;

  try {
    await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: tgChatId,
        text,
        disable_web_page_preview: true,
      }),
    });
  } catch (err) {
    console.error('[Notification] Telegram cancellation notify failed:', err);
  }
}

/**
 * Synchronizes cancellation and records outgoing payment (PaymentOut) in MoySklad
 */
async function syncCancellationToMoySklad(order: Order, reason: string, refundSuccess: boolean) {
  if (!TOKEN) return;

  const cleanId = order.id.replace(/^№\s*/, '').trim();

  try {
    // 1. Find CustomerOrder in MoySklad
    const searchRes = await fetch(
      `${API_URL}/entity/customerorder?filter=name~=${encodeURIComponent(cleanId)}&limit=1`,
      { headers: getMoySkladHeaders() }
    );

    if (!searchRes.ok) return;
    const searchData = await searchRes.json();
    if (!searchData.rows || searchData.rows.length === 0) return;

    const msOrder = searchData.rows[0];

    // 2. Set state to "Отменен" if not already cancelled
    if (msOrder.state?.meta?.href !== STATE_CANCELLED_HREF) {
      await fetch(msOrder.meta.href, {
        method: 'PUT',
        headers: getMoySkladHeaders(),
        body: JSON.stringify({
          state: {
            meta: {
              href: STATE_CANCELLED_HREF,
              type: 'state',
              mediaType: 'application/json',
            },
          },
        }),
      });
    }

    // 3. If ePay refund was executed, register outgoing payment (PaymentOut) in MoySklad
    if (refundSuccess && msOrder.agent?.meta) {
      try {
        const paymentOutPayload = {
          organization: {
            meta: {
              href: ORGANIZATION_HREF,
              type: 'organization',
              mediaType: 'application/json',
            },
          },
          agent: {
            meta: msOrder.agent.meta,
          },
          sum: Math.round(order.amount * 100),
          description: `Возврат средств покупателю Halyk ePay по отмененному заказу №${cleanId}. Причина: ${reason}`,
          operations: [
            {
              meta: msOrder.meta,
              linkedSum: Math.round(order.amount * 100),
            },
          ],
        };

        await fetch(`${API_URL}/entity/paymentout`, {
          method: 'POST',
          headers: getMoySkladHeaders(),
          body: JSON.stringify(paymentOutPayload),
        });
        console.log(`[MoySklad] Linked PaymentOut registered for cancelled order #${cleanId}`);
      } catch (payOutErr) {
        console.warn('[MoySklad] PaymentOut creation warning:', payOutErr);
      }
    }
  } catch (e) {
    console.error('[MoySklad] Sync cancellation error:', e);
  }
}

/**
 * Universal order cancellation and refund executor
 */
export async function cancelAndRefundOrder(params: {
  orderId: string;
  reason?: string;
  cancelledBy?: 'admin' | 'user' | 'system';
}): Promise<CancelOrderResult> {
  const cleanId = params.orderId.replace(/^№\s*/, '').trim();
  const reasonText = (params.reason || '').trim() || 'Заказ отменен администратором магазина.';
  const cancelledBy = params.cancelledBy || 'admin';

  console.log(`[Order Cancellation] Starting cancellation for Order #${cleanId}. Reason: "${reasonText}"`);

  // 1. Locate order in database
  const found = await findFirestoreOrder(cleanId);
  if (!found) {
    console.warn(`[Order Cancellation] Order #${cleanId} not found in Firestore.`);
    return {
      success: false,
      orderId: cleanId,
      message: `Заказ №${cleanId} не найден в базе данных сайта`,
      error: 'Order not found',
    };
  }

  const { ref: orderRef, data: order } = found;

  // 2. Prevent duplicate refund if order was already cancelled & refunded
  if (order.status === 'declined' && order.refundStatus === 'completed') {
    console.log(`[Order Cancellation] Order #${cleanId} was already cancelled and refunded.`);
    return {
      success: true,
      orderId: cleanId,
      order,
      message: 'Заказ уже был ранее отменен, а возврат средств выполнен.',
    };
  }

  let refundResult: EpayRefundResult | undefined;
  let refundStatus: 'completed' | 'pending' | 'failed' | 'manual_required' | 'not_applicable' = 'not_applicable';
  let refundMessage = 'Заказ отменен. Оплата не производилась.';

  // 3. If order was paid, execute automatic refund via Halyk ePay
  const isPaid = order.status === 'paid' || Boolean(order.receiptUrl);

  if (isPaid) {
    console.log(`[Order Cancellation] Order #${cleanId} was paid (${order.amount} ₸). Initiating ePay refund...`);
    refundResult = await refundEpayPayment({
      invoiceId: cleanId,
      amount: order.amount,
      reason: reasonText,
    });

    refundStatus = refundResult.status;

    if (refundResult.success) {
      refundMessage = `Средства в размере ${order.amount.toLocaleString('ru-RU')} ₸ успешно возвращены на банковскую карту через Halyk ePay. Срок зачисления на счет зависит от вашего банка и обычно составляет от 1 до 5 рабочих дней.`;
    } else {
      refundMessage = refundResult.message;
    }
  }

  // 4. Update Firestore
  const nowIso = new Date().toISOString();
  const updatedOrder: Order = {
    ...order,
    status: 'declined',
    cancelledAt: nowIso,
    cancelledBy,
    cancellationReason: reasonText,
    refundStatus,
    refundAmount: isPaid ? order.amount : 0,
    refundTransactionId: refundResult?.transactionId || undefined,
    refundMessage,
  };

  try {
    await updateDoc(orderRef, {
      status: 'declined',
      cancelledAt: nowIso,
      cancelledBy,
      cancellationReason: reasonText,
      refundStatus,
      refundAmount: isPaid ? order.amount : 0,
      refundTransactionId: refundResult?.transactionId || null,
      refundMessage,
    });

    if (order.userId) {
      const userOrderRef = doc(db, 'users', order.userId, 'orders', order.id);
      await updateDoc(userOrderRef, {
        status: 'declined',
        cancelledAt: nowIso,
        cancelledBy,
        cancellationReason: reasonText,
        refundStatus,
        refundAmount: isPaid ? order.amount : 0,
        refundTransactionId: refundResult?.transactionId || null,
        refundMessage,
      }).catch(() => {});
    }
  } catch (dbErr) {
    console.error(`[Order Cancellation] Error updating Firestore for #${cleanId}:`, dbErr);
  }

  // 5. Synchronize with MoySklad (Set state to "Отменен" & create PaymentOut)
  await syncCancellationToMoySklad(updatedOrder, reasonText, Boolean(refundResult?.success));

  // 6. Notify Telegram channel
  await notifyTelegramCancellation(updatedOrder, reasonText, refundResult);

  return {
    success: true,
    orderId: cleanId,
    order: updatedOrder,
    refundResult,
    message: `Заказ №${cleanId} успешно отменен. ${refundMessage}`,
  };
}
