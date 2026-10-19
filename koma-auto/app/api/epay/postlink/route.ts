import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc } from 'firebase/firestore';
import { Order } from '@/lib/order-types';
import { syncOrderToMoySklad } from '@/lib/moysklad-order';

export async function POST(request: Request) {
  try {
    const data = await request.json();
    console.log('[Halyk ePay Postlink received]:', JSON.stringify(data, null, 2));

    const {
      invoiceId,
      amount,
      currency,
      approvalCode,
      code,
      reason,
      reasonCode,
      reference,
      terminal,
      cardMask,
      cardType,
      dateTime,
    } = data;

    if (code === 'ok') {
      console.log(`[Halyk ePay Payment SUCCESS]: Order ${invoiceId}, Amount: ${amount} ${currency}, Ref: ${reference}, Approval: ${approvalCode}`);

      try {
        const orderRef = doc(db, 'orders', invoiceId);
        const orderSnap = await getDoc(orderRef);
        if (orderSnap.exists()) {
          const orderData = orderSnap.data() as Order;
          const updatedOrder: Order = {
            ...orderData,
            status: 'paid',
            receiptUrl: `https://epay.homebank.kz/receipt/${invoiceId}`,
            notificationSent: true,
          };
          await updateDoc(orderRef, {
            status: 'paid',
            receiptUrl: updatedOrder.receiptUrl,
            notificationSent: true,
          });

          if (orderData.userId) {
            const userOrderRef = doc(db, 'users', orderData.userId, 'orders', invoiceId);
            await updateDoc(userOrderRef, {
              status: 'paid',
              receiptUrl: updatedOrder.receiptUrl,
              notificationSent: true,
            }).catch(() => {});
          }

          // Send push notifications only if not already notified
          if (!orderData.notificationSent) {
            await syncOrderToMoySklad(updatedOrder);
          }
        }
      } catch (fbErr) {
        console.error('Error updating order on postlink payment success:', fbErr);
      }
    } else {
      console.warn(`[Halyk ePay Payment FAILED/DECLINED]: Order ${invoiceId}, Reason: ${reason} (code: ${reasonCode})`);
      try {
        const orderRef = doc(db, 'orders', invoiceId);
        await updateDoc(orderRef, { status: 'declined' }).catch(() => {});
      } catch (e) {
        // ignore
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
