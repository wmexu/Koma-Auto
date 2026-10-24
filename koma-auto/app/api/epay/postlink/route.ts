import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { Order } from '@/lib/order-types';
import { syncOrderToMoySklad, markMoySkladOrderCancelled } from '@/lib/moysklad-order';
import { verifyEpayPayment } from '@/lib/epay-refund';

export async function POST(request: Request) {
  try {
    const rawText = await request.text();
    console.log('[Halyk ePay Postlink received raw]:', rawText);

    let data: any = {};
    try {
      data = JSON.parse(rawText);
    } catch {
      try {
        const params = new URLSearchParams(rawText);
        data = Object.fromEntries(params.entries());
      } catch (err) {
        console.error('[Halyk ePay Postlink] Failed to parse body:', err);
      }
    }

    console.log('[Halyk ePay Postlink parsed data]:', JSON.stringify(data, null, 2));

    const invoiceId = data.invoiceId || data.invoiceID || data.OrderId || data.orderId || data.id;
    const amount = Number(data.amount) || 0;
    const currency = data.currency || 'KZT';
    const reference = data.reference || '';
    const approvalCode = String(data.approvalCode || '').trim();
    const code = String(data.code || '').toLowerCase().trim();
    const reason = String(data.reason || '').toLowerCase().trim();
    const reasonCode = String(data.reasonCode ?? '').trim();

    // Any indicator of success from Halyk ePay:
    const isSuccess =
      code === 'ok' ||
      code === '00' ||
      code === '0' ||
      reason === 'success' ||
      reason === 'ok' ||
      reasonCode === '0' ||
      reasonCode === '00' ||
      (approvalCode.length > 0 && approvalCode !== '0' && approvalCode !== '000000');

    if (isSuccess && invoiceId) {
      console.log(`[Halyk ePay Payment SUCCESS]: Order ${invoiceId}, Amount: ${amount} ${currency}, Ref: ${reference}, Approval: ${approvalCode}`);

      // Double-verify directly against Halyk ePay transaction ledger
      const epayCheck = await verifyEpayPayment(invoiceId);
      if (!epayCheck.paid) {
        console.warn(`[Security Alert] Postlink webhook received for ${invoiceId} but transaction was not found/paid in Halyk bank API.`);
        return NextResponse.json({ status: 'unverified' }, { status: 200 });
      }

      let updatedOrder: Order | null = null;

      try {
        const orderRef = doc(db, 'orders', invoiceId);
        const orderSnap = await getDoc(orderRef);

        if (orderSnap.exists()) {
          const orderData = orderSnap.data() as Order;
          updatedOrder = {
            ...orderData,
            status: 'paid',
            receiptUrl: `https://epay.homebank.kz/receipt/${invoiceId}`,
            notificationSent: true,
          };
          await updateDoc(orderRef, {
            status: 'paid',
            receiptUrl: updatedOrder.receiptUrl,
            notificationSent: true,
          }).catch(() => {});

          if (orderData.userId) {
            const userOrderRef = doc(db, 'users', orderData.userId, 'orders', invoiceId);
            await updateDoc(userOrderRef, {
              status: 'paid',
              receiptUrl: updatedOrder.receiptUrl,
              notificationSent: true,
            }).catch(() => {});
          }
        }
      } catch (fbErr) {
        console.warn('[Halyk Postlink] Firestore access skipped/failed (will proceed with fallback):', fbErr);
      }

      if (!updatedOrder) {
        // Fallback: construct valid order from ePay callback data
        console.log(`[Halyk Postlink] Order ${invoiceId} using fallback payload for MoySklad & Telegram notification.`);
        updatedOrder = {
          id: invoiceId,
          invoiceId,
          createdAt: data.dateTime || new Date().toISOString(),
          expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
          status: 'paid',
          amount: amount,
          itemsPrice: amount,
          deliveryCost: 0,
          deliveryMethod: 'pickup',
          address: 'Оплата онлайн (ePay)',
          customer: {
            name: data.name || 'Покупатель',
            phone: data.phone || '',
            email: data.email || '',
          },
          paymentMethod: 'online',
          receiptUrl: `https://epay.homebank.kz/receipt/${invoiceId}`,
          items: [],
          notificationSent: true,
        };
      }

      // Always execute sync to MoySklad (Confirmed State, PaymentIn, Task) & Telegram
      try {
        await syncOrderToMoySklad(updatedOrder);
      } catch (syncErr) {
        console.error('[Halyk Postlink] Error syncing to MoySklad/Telegram:', syncErr);
      }
    } else {
      console.warn(`[Halyk ePay Payment NOT SUCCESS]: Order ${invoiceId}, code=${code}, reason=${reason}, reasonCode=${reasonCode}`);

      // ONLY mark as declined if Halyk explicitly reports a terminal rejection
      const isExplicitFailure =
        code === 'fail' ||
        code === 'failed' ||
        code === 'error' ||
        code === 'declined' ||
        reason === 'fail' ||
        reason === 'declined';

      if (isExplicitFailure && invoiceId) {
        try {
          const orderRef = doc(db, 'orders', invoiceId);
          await updateDoc(orderRef, { status: 'declined' }).catch(() => {});
          await markMoySkladOrderCancelled(invoiceId, 'Оплата не прошла');
        } catch (e) {
          // ignore
        }
      }
    }

    // ePay expects 200 OK with simple json or status ok
    return NextResponse.json({ status: 'ok', invoiceId });
  } catch (error) {
    console.error('Error handling Halyk ePay postlink:', error);
    return NextResponse.json({ status: 'error' }, { status: 200 }); // Still return 200 to prevent infinite webhook retries
  }
}

export async function GET() {
  return NextResponse.json({ status: 'Halyk ePay postlink endpoint active' });
}
