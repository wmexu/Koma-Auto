import { NextResponse } from 'next/server';
import { cancelAndRefundOrder } from '@/lib/order-cancellation';

const TOKEN = process.env.MOYSKLAD_TOKEN;

function getMoySkladHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Accept-Encoding': 'gzip',
  };
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    console.log('[MoySklad Webhook received]:', rawBody);

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.warn('[MoySklad Webhook] Non-JSON payload received');
      return NextResponse.json({ status: 'ok' });
    }

    const events = payload.events;
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ status: 'ok', message: 'No events' });
    }

    const results: any[] = [];

    for (const event of events) {
      if (event.meta?.type === 'customerorder' && event.action === 'UPDATE' && event.meta?.href) {
        try {
          // Fetch current state of the customer order from MoySklad
          const orderRes = await fetch(`${event.meta.href}?expand=state,attributes`, {
            headers: getMoySkladHeaders(),
          });

          if (!orderRes.ok) {
            console.warn(`[MoySklad Webhook] Failed to fetch customerorder ${event.meta.href}: ${orderRes.status}`);
            continue;
          }

          const msOrder = await orderRes.json();
          const stateName = msOrder.state?.name || '';
          const stateType = msOrder.state?.stateType || '';
          const isCancelled =
            stateName.toLowerCase().includes('отменен') ||
            stateName.toLowerCase().includes('возврат') ||
            stateType === 'Unsuccessful';

          console.log(`[MoySklad Webhook] Order "${msOrder.name}", State: "${stateName}", Cancelled: ${isCancelled}`);

          if (isCancelled && msOrder.name) {
            // Extract cancellation reason from custom attributes or description
            let reason = '';

            // Check custom attributes
            if (Array.isArray(msOrder.attributes)) {
              const reasonAttr = msOrder.attributes.find(
                (a: any) =>
                  a.name?.toLowerCase().includes('причина') ||
                  a.name?.toLowerCase().includes('отмен')
              );
              if (reasonAttr && reasonAttr.value) {
                reason = typeof reasonAttr.value === 'object' ? reasonAttr.value.name : String(reasonAttr.value);
              }
            }

            // Fallback: check if description has "Причина:" line
            if (!reason && msOrder.description) {
              const match = msOrder.description.match(/(?:причина(?:\s+отмены)?[:\-]\s*)([^\r\n]+)/i);
              if (match) {
                reason = match[1].trim();
              }
            }

            if (!reason) {
              reason = 'Заказ отменен администратором в МойСклад.';
            }

            // Execute cancellation and automatic ePay refund
            const cancelResult = await cancelAndRefundOrder({
              orderId: msOrder.name,
              reason,
              cancelledBy: 'admin',
            });

            results.push(cancelResult);
          }
        } catch (eventErr) {
          console.error('[MoySklad Webhook] Error processing event:', eventErr);
        }
      }
    }

    return NextResponse.json({ status: 'ok', processed: results.length, results });
  } catch (error: any) {
    console.error('[MoySklad Webhook Fatal Error]:', error);
    // Always return 200 OK so MoySklad does not endlessly retry failed deliveries
    return NextResponse.json({ status: 'error', message: error?.message }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'active', service: 'MoySklad Webhook Endpoint' });
}
