import { NextResponse } from 'next/server';
import { db } from '@/lib/firebase';
import { doc, getDoc, updateDoc, setDoc } from 'firebase/firestore';
import { Order } from '@/lib/order-types';
import { syncOrderToMoySklad, markMoySkladOrderCancelled } from '@/lib/moysklad-order';
import { verifyEpayPayment } from '@/lib/epay-refund';
import { client, isDbConfigured } from '@/db';
import { resolveAndEnsureUserId } from '@/lib/db-users';

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

      // If Firestore didn't have order, fetch authoritative order data from Neon PostgreSQL
      if (!updatedOrder && isDbConfigured() && client) {
        try {
          const dbRows = await client`
            SELECT * FROM orders WHERE id = ${String(invoiceId)} OR invoice_id = ${String(invoiceId)} LIMIT 1;
          `;
          if (dbRows && dbRows.length > 0) {
            const row = dbRows[0];
            let items: any[] = [];
            if (Array.isArray(row.items)) items = row.items;
            else if (typeof row.items === 'string') {
              try { items = JSON.parse(row.items); } catch {}
            }

            // Also check if user has user details in users table
            let userAccountDetails = null;
            if (row.user_id) {
              try {
                const uRows = await client`SELECT id, email, full_name, phone FROM users WHERE id = ${row.user_id} LIMIT 1;`;
                if (uRows && uRows.length > 0) {
                  userAccountDetails = {
                    uid: uRows[0].id,
                    email: uRows[0].email,
                    displayName: uRows[0].full_name,
                    phone: uRows[0].phone,
                  };
                }
              } catch {}
            }

            updatedOrder = {
              id: String(row.id),
              invoiceId: row.invoice_id || String(row.id),
              createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
              expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
              status: 'paid',
              amount: Number(row.amount) || amount || 0,
              itemsPrice: Number(row.items_price) || Number(row.amount) || 0,
              deliveryCost: Number(row.delivery_cost) || 0,
              deliveryMethod: (row.delivery_method as any) || 'pickup',
              address: row.delivery_address || (row.delivery_method === 'courier' ? 'Адрес доставки' : 'Самовывоз: Car City'),
              city: row.city || 'Алматы',
              customer: {
                name: row.customer_name || data.name || 'Покупатель',
                phone: row.customer_phone || data.phone || '',
                email: row.customer_email || data.email || '',
              },
              paymentMethod: (row.payment_method as any) || 'online',
              receiptUrl: `https://epay.homebank.kz/receipt/${invoiceId}`,
              items,
              userId: row.user_id || null,
              userAccountDetails,
              notificationSent: true,
            };
            console.log(`[Halyk Postlink] Order ${invoiceId} loaded authoritatively from Neon PostgreSQL.`);
          }
        } catch (dbErr) {
          console.warn('[Halyk Postlink] Neon DB lookup warning:', dbErr);
        }
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

      // Synchronize verified payment to Neon PostgreSQL for real-time CRM visibility (Guaranteed UPSERT)
      if (isDbConfigured() && client) {
        try {
          const ordId = String(invoiceId);

          // Check if order already has an authoritative customer name in DB (protect Cyrillic from Latin translit)
          const existingOrd = await client`
            SELECT customer_name, customer_email, user_id FROM orders WHERE id = ${ordId} LIMIT 1;
          `;

          let custName = updatedOrder?.customer?.name;
          const hasDbCyrillicName = existingOrd?.[0]?.customer_name && /[а-яА-ЯёЁ]/.test(existingOrd[0].customer_name);
          if (hasDbCyrillicName) {
            custName = existingOrd[0].customer_name;
          } else if (!custName || custName === 'Покупатель') {
            custName = existingOrd?.[0]?.customer_name || data.name || 'Покупатель';
          }

          const custPhone = updatedOrder?.customer?.phone || data.phone || '';
          const custEmail = (updatedOrder?.customer?.email || data.email || `customer_${ordId}@koma.kz`).toLowerCase().trim();
          const ordUserId = updatedOrder?.userId || null;
          const ordAmount = updatedOrder?.amount || amount || 0;
          const ordItemsPrice = updatedOrder?.itemsPrice || ordAmount;
          const ordDeliveryCost = updatedOrder?.deliveryCost || 0;
          const ordDeliveryMethod = updatedOrder?.deliveryMethod || 'pickup';
          const ordAddress = updatedOrder?.address || 'Оплата онлайн (ePay)';
          const ordCity = updatedOrder?.city || 'Алматы';
          const ordItems = JSON.stringify(updatedOrder?.items || []);

          const linkedUserId = await resolveAndEnsureUserId(
            ordUserId,
            custEmail,
            custName,
            custPhone
          );

          await client`
            INSERT INTO orders (
              id, invoice_id, user_id, amount, items_price, delivery_cost,
              delivery_method, payment_method, payment_status, fulfillment_status,
              customer_name, customer_phone, customer_email, delivery_address, city,
              items, warehouse_id, created_at, updated_at
            ) VALUES (
              ${ordId},
              ${ordId},
              ${linkedUserId},
              ${ordAmount},
              ${ordItemsPrice},
              ${ordDeliveryCost},
              ${ordDeliveryMethod},
              'online',
              'paid',
              'assembling',
              ${custName},
              ${custPhone},
              ${custEmail},
              ${ordAddress},
              ${ordCity},
              ${ordItems}::jsonb,
              'car_city_podval',
              NOW(),
              NOW()
            )
            ON CONFLICT (id) DO UPDATE SET
              payment_status = 'paid',
              fulfillment_status = CASE WHEN orders.fulfillment_status = 'deleted' THEN 'deleted' ELSE 'assembling' END,
              customer_name = COALESCE(EXCLUDED.customer_name, orders.customer_name),
              customer_phone = COALESCE(EXCLUDED.customer_phone, orders.customer_phone),
              customer_email = COALESCE(EXCLUDED.customer_email, orders.customer_email),
              updated_at = NOW();
          `;

          // Increment promocode usage counter if order utilized a promocode
          const usedPromoCode = updatedOrder?.promoCode;
          if (usedPromoCode && typeof usedPromoCode === 'string') {
            await client`
              UPDATE promocodes 
              SET used_count = used_count + 1 
              WHERE LOWER(code) = LOWER(${usedPromoCode.trim()});
            `.catch(e => console.warn('[Postlink] Promocode used_count update notice:', e));
          }
        } catch (neonErr) {
          console.error('[Halyk Postlink] Failed to upsert Neon order payment_status:', neonErr);
        }
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
