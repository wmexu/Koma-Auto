import dns from 'node:dns';
if (typeof dns.setDefaultResultOrder === 'function') {
  try { dns.setDefaultResultOrder('ipv4first'); } catch {}
}
import { Order } from './order-types';
import { sendOrderPushNotification, formatOrderReport } from './notifications';

const API_URL = process.env.MOYSKLAD_API_URL || 'https://api.moysklad.ru/api/remap/1.2';
const TOKEN = process.env.MOYSKLAD_TOKEN;

// Organization "КОМА АВТО"
const ORGANIZATION_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/organization/7909a58f-4aa7-11f1-0a80-1ac70019f4ae';
// Store "Car City 1 ярус Подвал"
const STORE_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/store/4240a87a-4ea5-11f1-0a80-1b5c0008497a';
// Default Manager / Employee (Таджибаев K. Д.)
const EMPLOYEE_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/employee/78f73abb-4aa7-11f1-0a80-1ac70019f460';
// Delivery Service in MoySklad
const DELIVERY_SERVICE_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/service/6c69e39c-cd3a-11f1-0a80-07fe0076a0e2';
// Test Order Service in MoySklad (Non-material service, NEVER affects stock or warehouse inventory)
const TEST_ORDER_SERVICE_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/service/9f999b6a-cd3c-11f1-0a80-03be00756911';

// CustomerOrder States in MoySklad
const STATE_NEW_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/79218f4f-4aa7-11f1-0a80-1ac70019f4ef'; // Новый
const STATE_CONFIRMED_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/79219082-4aa7-11f1-0a80-1ac70019f4f0'; // Подтвержден
const STATE_CANCELLED_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/79219399-4aa7-11f1-0a80-1ac70019f4f5'; // Отменен

function getGetHeaders() {
  return {
    'Authorization': `Bearer ${TOKEN}`,
    'Accept': 'application/json;charset=utf-8',
    'Accept-Encoding': 'gzip',
  };
}

function getHeaders() {
  return {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json;charset=utf-8',
    'Accept-Encoding': 'gzip',
  };
}

/**
 * Finds or creates a counterparty in MoySklad by phone number
 */
async function findOrCreateCounterparty(order: Order): Promise<{ href: string; type: string; mediaType: string }> {
  const cleanPhone = (order.customer.phone || '').replace(/\D/g, '');
  const searchPhone = cleanPhone.length >= 10 ? cleanPhone.slice(-10) : cleanPhone;

  if (searchPhone) {
    try {
      const searchRes = await fetch(
        `${API_URL}/entity/counterparty?filter=phone~=${encodeURIComponent(searchPhone)}&limit=1`,
        { headers: getGetHeaders() }
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.rows && searchData.rows.length > 0) {
          return {
            href: searchData.rows[0].meta.href,
            type: 'counterparty',
            mediaType: 'application/json',
          };
        }
      }
    } catch (e) {
      console.warn('[MoySklad] Counterparty search failed, proceeding to creation:', e);
    }
  }

  // Create new counterparty
  const createRes = await fetch(`${API_URL}/entity/counterparty`, {
    method: 'POST',
    headers: getHeaders(),
    body: JSON.stringify({
      name: order.customer.name || `Покупатель ${order.customer.phone || order.id}`,
      phone: order.customer.phone || undefined,
      email: order.customer.email || undefined,
      description: `Создан автоматически из интернет-магазина koma.com.kz`,
    }),
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    throw new Error(`Failed to create counterparty in MoySklad: ${createRes.status} ${errText}`);
  }

  const createdData = await createRes.json();
  return {
    href: createdData.meta.href,
    type: 'counterparty',
    mediaType: 'application/json',
  };
}

/**
 * Builds valid positions for MoySklad CustomerOrder ensuring calculated sum matches order.amount
 */
async function buildOrderPositions(order: Order): Promise<any[]> {
  const targetTotal = Math.round(order.amount);
  const positions: any[] = [];

  // 1. If test order (promo 10, 50, 100 ₸ applied):
  // Uses dedicated non-material service "Тестовый платеж (проверка ePay)".
  // Real warehouse inventory / stock is NEVER affected or reserved!
  if (order.isTestOrder) {
    positions.push({
      quantity: 1,
      price: targetTotal * 100, // in minor units (tiyn)
      assortment: {
        meta: {
          href: TEST_ORDER_SERVICE_HREF,
          type: 'service',
          mediaType: 'application/json',
        },
      },
      reserve: 0,
    });
    return positions;
  }

  // 2. Normal orders: map products
  if (order.items && order.items.length > 0) {
    for (const item of order.items) {
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id);
      let itemMeta: any = null;

      if (isUuid) {
        itemMeta = {
          href: `${API_URL}/entity/product/${item.id}`,
          type: 'product',
          mediaType: 'application/json',
        };
      } else {
        const searchCode = item.oem || item.article;
        if (searchCode) {
          try {
            const clean = searchCode.replace(/[\s\-\.]/g, '');
            const pRes = await fetch(`${API_URL}/entity/product?filter=code~=${encodeURIComponent(clean)}&limit=1`, {
              headers: getGetHeaders(),
            });
            if (pRes.ok) {
              const pData = await pRes.json();
              if (pData.rows && pData.rows.length > 0) {
                itemMeta = pData.rows[0].meta;
              }
            }
          } catch (e) {
            // fallback
          }
        }
      }

      if (!itemMeta) {
        itemMeta = {
          href: DELIVERY_SERVICE_HREF,
          type: 'service',
          mediaType: 'application/json',
        };
      }

      positions.push({
        quantity: item.quantity || 1,
        price: Math.round(item.price * 100),
        assortment: { meta: itemMeta },
      });
    }
  }

  // 3. Add delivery service position if applicable
  if (order.deliveryCost && order.deliveryCost > 0) {
    positions.push({
      quantity: 1,
      price: Math.round(order.deliveryCost * 100),
      assortment: {
        meta: {
          href: DELIVERY_SERVICE_HREF,
          type: 'service',
          mediaType: 'application/json',
        },
      },
    });
  }

  // 4. Ensure non-empty positions so MoySklad calculates the real sum
  if (positions.length === 0 && targetTotal > 0) {
    positions.push({
      quantity: 1,
      price: targetTotal * 100,
      assortment: {
        meta: {
          href: DELIVERY_SERVICE_HREF,
          type: 'service',
          mediaType: 'application/json',
        },
      },
    });
  }

  return positions;
}

/**
 * Creates CustomerOrder in MoySklad in "Новый" status without sending push notification.
 * Triggered as soon as customer reaches payment page.
 */
export async function createMoySkladOrder(order: Order): Promise<{
  success: boolean;
  mode: 'live' | 'safe-dry-run' | 'test-order-skipped';
  moySkladOrderId?: string;
  error?: string;
}> {
  const isEnabled = process.env.MOYSKLAD_SYNC_ENABLED === 'true';

  if (!isEnabled) {
    console.log(
      `[MoySklad SAFE-MODE] Sync disabled (MOYSKLAD_SYNC_ENABLED !== 'true'). Order #${order.id} registered safely.`
    );
    return {
      success: true,
      mode: 'safe-dry-run',
      moySkladOrderId: `mock-ms-order-${order.id}`,
    };
  }

  if (!TOKEN) {
    console.error('[MoySklad] MOYSKLAD_TOKEN is not defined in environment variables');
    return { success: false, mode: 'live', error: 'MOYSKLAD_TOKEN is missing' };
  }

  try {
    const counterpartyMeta = await findOrCreateCounterparty(order);

    const cleanId = order.id.replace(/^№\s*/, '');
    const description = formatOrderReport(order).replace(/\r?\n/g, '\r\n');
    const positions = await buildOrderPositions(order);

    const orderPayload = {
      name: cleanId,
      description,
      organization: {
        meta: {
          href: ORGANIZATION_HREF,
          type: 'organization',
          mediaType: 'application/json',
        },
      },
      agent: {
        meta: counterpartyMeta,
      },
      store: {
        meta: {
          href: STORE_HREF,
          type: 'store',
          mediaType: 'application/json',
        },
      },
      state: {
        meta: {
          href: STATE_NEW_HREF,
          type: 'state',
          mediaType: 'application/json',
        },
      },
      positions,
    };

    const orderRes = await fetch(`${API_URL}/entity/customerorder`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(orderPayload),
    });

    if (!orderRes.ok) {
      const err = await orderRes.text();
      console.error('[MoySklad] Failed to create customer order:', orderRes.status, err);
      return { success: false, mode: 'live', error: `MoySklad Order Error: ${orderRes.status} ${err}` };
    }

    const orderData = await orderRes.json();
    return {
      success: true,
      mode: 'live',
      moySkladOrderId: orderData.id,
    };
  } catch (error: any) {
    console.error('[MoySklad] Error creating order:', error);
    return { success: false, mode: 'live', error: error?.message || 'Unknown error' };
  }
}

/**
 * Marks order as paid in MoySklad and sends push notification (MoySklad Task + Telegram).
 * Triggered ONLY once online payment is confirmed.
 */
export async function notifyMoySkladOrderPaid(order: Order): Promise<{
  success: boolean;
  moySkladTaskId?: string;
  pushChannels: string[];
  error?: string;
}> {
  const isEnabled = process.env.MOYSKLAD_SYNC_ENABLED === 'true' || (process.env.MOYSKLAD_SYNC_ENABLED !== 'false' && Boolean(process.env.MOYSKLAD_TOKEN));

  // 1. Send external push notifications (Telegram)
  let pushChannels: string[] = [];
  try {
    const pushResult = await sendOrderPushNotification(order);
    pushChannels = pushResult.channels;
  } catch (pushErr) {
    console.error('[Notification] Error dispatching push:', pushErr);
  }

  if (!isEnabled || !TOKEN) {
    console.log(`[MoySklad SAFE-MODE] Paid push sent via: ${pushChannels.join(', ') || 'none'}. MoySklad task skipped.`);
    return { success: true, pushChannels };
  }

  let createdTaskId: string | undefined;

  try {
    const counterpartyMeta = await findOrCreateCounterparty(order);
    const cleanId = order.id.replace(/^№\s*/, '');

    // 2. Find or create CustomerOrder in MoySklad
    let msOrder: any = null;
    try {
      let searchRes = await fetch(
        `${API_URL}/entity/customerorder?filter=name=${encodeURIComponent(cleanId)}&limit=1`,
        { headers: getGetHeaders() }
      );
      if (!searchRes.ok || (await searchRes.clone().json().then((d: any) => !d.rows || d.rows.length === 0).catch(() => true))) {
        searchRes = await fetch(
          `${API_URL}/entity/customerorder?filter=name~=${encodeURIComponent(cleanId)}&limit=1`,
          { headers: getGetHeaders() }
        );
      }
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (searchData.rows && searchData.rows.length > 0) {
          msOrder = searchData.rows[0];

          // Update state to confirmed (paid) and update description with payment receipt
          const updatedDescription = formatOrderReport(order).replace(/\r?\n/g, '\r\n');
          const putRes = await fetch(msOrder.meta.href, {
            method: 'PUT',
            headers: getHeaders(),
            body: JSON.stringify({
              state: {
                meta: {
                  href: STATE_CONFIRMED_HREF,
                  type: 'state',
                  mediaType: 'application/json',
                },
              },
              description: updatedDescription,
            }),
          });
          if (putRes.ok) {
            console.log(`[MoySklad] Successfully updated order #${cleanId} status to "Подтвержден"`);
          } else {
            console.error(`[MoySklad] Failed to update order state to "Подтвержден":`, await putRes.text());
          }
        } else {
          console.warn(`[MoySklad] CustomerOrder #${cleanId} not found by name`);
        }
      } else {
        console.error(`[MoySklad] CustomerOrder search failed with status ${searchRes.status}:`, await searchRes.text());
      }
    } catch (e) {
      console.warn('[MoySklad] Could not search/update order state:', e);
    }

    // If order was not yet created, create it now in confirmed state
    if (!msOrder) {
      try {
        const positions = await buildOrderPositions(order);
        const description = formatOrderReport(order).replace(/\r?\n/g, '\r\n');

        const createRes = await fetch(`${API_URL}/entity/customerorder`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            name: cleanId,
            description,
            organization: { meta: { href: ORGANIZATION_HREF, type: 'organization', mediaType: 'application/json' } },
            agent: { meta: counterpartyMeta },
            store: { meta: { href: STORE_HREF, type: 'store', mediaType: 'application/json' } },
            state: { meta: { href: STATE_CONFIRMED_HREF, type: 'state', mediaType: 'application/json' } },
            positions,
          }),
        });
        if (createRes.ok) {
          msOrder = await createRes.json();
        }
      } catch (err) {
        console.warn('[MoySklad] Fallback order creation failed:', err);
      }
    }

    // 3. Register Incoming Payment (Входящий платеж / PaymentIn) linked to CustomerOrder
    if (msOrder && msOrder.meta) {
      try {
        const paymentPayload = {
          organization: { meta: { href: ORGANIZATION_HREF, type: 'organization', mediaType: 'application/json' } },
          agent: { meta: counterpartyMeta },
          sum: Math.round(order.amount * 100),
          description: `Оплата онлайн Halyk ePay по заказу №${cleanId}`,
          operations: [
            {
              meta: msOrder.meta,
              linkedSum: Math.round(order.amount * 100),
            },
          ],
        };

        const payRes = await fetch(`${API_URL}/entity/paymentin`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify(paymentPayload),
        });

        if (payRes.ok) {
          pushChannels.push('moysklad_payment');
          console.log(`[MoySklad] PaymentIn created successfully for order #${order.id}`);
        } else {
          console.warn('[MoySklad] Failed to create PaymentIn:', await payRes.text());
        }
      } catch (payErr) {
        console.warn('[MoySklad] Error creating PaymentIn:', payErr);
      }
    }

    // 4. Create Task in MoySklad for Employee (triggers native push notification in MoySklad mobile app)
    const deliveryTypeStr =
      order.deliveryMethod === 'courier' ? 'Курьерская доставка' : 'Самовывоз (Car City)';

    const userAccountStr = order.userAccountDetails
      ? `Аккаунт: ${order.userAccountDetails.email || order.userAccountDetails.uid}`
      : 'Гостевой заказ';

    const prefix = order.isTestOrder ? 'ТЕСТОВЫЙ ЗАКАЗ. ИГНОРИРУЙТЕ\r\n' : (order.customer.comment ? `${order.customer.comment}\r\n` : '');
    const taskDescription = `${prefix}ОПЛАЧЕН заказ №${cleanId} на ${order.amount.toLocaleString('ru-RU')} ₸!\r\nКлиент: ${order.customer.name}, тел: ${order.customer.phone}\r\n${userAccountStr}\r\nСпособ: ${deliveryTypeStr}\r\nАдрес: ${order.address}`;

    const taskPayload: any = {
      description: taskDescription,
      assignee: {
        meta: {
          href: EMPLOYEE_HREF,
          type: 'employee',
          mediaType: 'application/json',
        },
      },
    };

    if (msOrder && msOrder.meta) {
      taskPayload.operation = { meta: msOrder.meta };
    }

    const taskRes = await fetch(`${API_URL}/entity/task`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(taskPayload),
    });

    if (taskRes.ok) {
      const taskData = await taskRes.json();
      createdTaskId = taskData.id;
      pushChannels.push('moysklad_task');
      console.log(`[MoySklad] Employee task push notification created for order #${order.id}`);
    } else {
      console.warn('[MoySklad] Failed to create employee task notification:', await taskRes.text());
    }

    return {
      success: true,
      moySkladTaskId: createdTaskId,
      pushChannels,
    };
  } catch (error: any) {
    console.error('[MoySklad] Error notifying order paid:', error);
    return { success: false, pushChannels, error: error?.message };
  }
}

/**
 * Backward compatible synchronization entry point
 */
export async function syncOrderToMoySklad(order: Order) {
  if (order.status === 'paid') {
    return notifyMoySkladOrderPaid(order);
  }
  return createMoySkladOrder(order);
}

/**
 * Updates order state to "Отменен" with description "Оплата не прошла" in MoySklad
 */
export async function markMoySkladOrderCancelled(orderId: string, reason: string = 'Оплата не прошла'): Promise<boolean> {
  if (!TOKEN) {
    console.warn('[MoySklad] MOYSKLAD_TOKEN is missing, cannot cancel order');
    return false;
  }

  try {
    const cleanId = orderId.replace(/^№\s*/, '').trim();
    const searchRes = await fetch(
      `${API_URL}/entity/customerorder?filter=name~=${encodeURIComponent(cleanId)}&limit=1`,
      { headers: getGetHeaders() }
    );

    if (!searchRes.ok) return false;
    const searchData = await searchRes.json();
    if (!searchData.rows || searchData.rows.length === 0) {
      console.warn(`[MoySklad Cancel] Order #${cleanId} not found in MoySklad to cancel`);
      return false;
    }

    const msOrder = searchData.rows[0];
    const prevDesc = msOrder.description || '';
    const newDesc = prevDesc
      ? `[ОТМЕНА: ${reason}]\r\n${prevDesc}`
      : `Оплата не прошла: ${reason}`;

    const updateRes = await fetch(msOrder.meta.href, {
      method: 'PUT',
      headers: getHeaders(),
      body: JSON.stringify({
        state: {
          meta: {
            href: STATE_CANCELLED_HREF,
            type: 'state',
            mediaType: 'application/json',
          },
        },
        description: newDesc,
      }),
    });

    if (updateRes.ok) {
      console.log(`[MoySklad] Order #${cleanId} state updated to "Отменен" ("${reason}")`);
      return true;
    }
  } catch (err) {
    console.error(`[MoySklad] Error cancelling order #${orderId}:`, err);
  }
  return false;
}
