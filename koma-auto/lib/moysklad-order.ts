import { Order } from './order-types';

const API_URL = process.env.MOYSKLAD_API_URL || 'https://api.moysklad.ru/api/remap/1.2';
const TOKEN = process.env.MOYSKLAD_TOKEN;

// Organization "КОМА АВТО"
const ORGANIZATION_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/organization/7909a58f-4aa7-11f1-0a80-1ac70019f4ae';
// Store "Car City 1 ярус Подвал"
const STORE_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/store/4240a87a-4ea5-11f1-0a80-1b5c0008497a';
// Default Manager / Employee (Таджибаев K. Д.)
const EMPLOYEE_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/employee/78f73abb-4aa7-11f1-0a80-1ac70019f460';

// CustomerOrder States in MoySklad
const STATE_NEW_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/79218f4f-4aa7-11f1-0a80-1ac70019f4ef'; // Новый
const STATE_CONFIRMED_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/79219082-4aa7-11f1-0a80-1ac70019f4f0'; // Подтвержден

function getHeaders() {
  return {
    'Authorization': `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
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
        { headers: getHeaders() }
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
 * Syncs order to MoySklad (creates CustomerOrder and assigns Task notification to employee)
 */
export async function syncOrderToMoySklad(order: Order): Promise<{
  success: boolean;
  mode: 'live' | 'safe-dry-run' | 'test-order-skipped';
  moySkladOrderId?: string;
  moySkladTaskId?: string;
  error?: string;
}> {
  const isEnabled = process.env.MOYSKLAD_SYNC_ENABLED === 'true';

  if (order.isTestOrder) {
    console.log(`[MoySklad] Test order #${order.id} detected. Skipping warehouse dispatch.`);
    return {
      success: true,
      mode: 'test-order-skipped',
      moySkladOrderId: `test-order-${order.id}`,
    };
  }

  // SAFETY CHECK: During active office hours or development testing,
  // do not send live requests unless MOYSKLAD_SYNC_ENABLED is explicitly true.
  if (!isEnabled) {
    console.log(
      `[MoySklad SAFE-MODE] Sync is disabled (MOYSKLAD_SYNC_ENABLED !== 'true'). Order #${order.id} will not trigger live notifications to active office staff.`
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
    // 1. Get or create counterparty
    const counterpartyMeta = await findOrCreateCounterparty(order);

    // 2. Prepare order description
    const deliveryTypeStr =
      order.deliveryMethod === 'courier' ? 'Курьерская доставка' : 'Самовывоз из магазина (Car City)';
    const paymentStatusStr =
      order.status === 'paid' ? 'ОПЛАЧЕНО (Halyk ePay)' : 'НЕ ОПЛАЧЕНО (Ожидает оплаты)';

    const description = `=== ЗАКАЗ ИЗ ИНТЕРНЕТ-МАГАЗИНА KOMA.COM.KZ ===
Номер заказа: №${order.id}
Статус оплаты: ${paymentStatusStr}
Способ получения: ${deliveryTypeStr}
Адрес: ${order.address}
Получатель: ${order.customer.name}
Телефон: ${order.customer.phone}
Email: ${order.customer.email || 'Не указан'}
Комментарий клиента: ${order.customer.comment || 'Нет'}
---------------------------------------------
Сумма товаров: ${order.itemsPrice.toLocaleString('ru-RU')} ₸
Стоимость доставки: ${order.deliveryCost > 0 ? `${order.deliveryCost.toLocaleString('ru-RU')} ₸` : 'Бесплатно'}
ИТОГО К ОПЛАТЕ: ${order.amount.toLocaleString('ru-RU')} ₸`;

    // 3. Format positions
    const positions = order.items.map((item) => {
      // Check if id is a UUID
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.id);
      return {
        quantity: item.quantity,
        price: Math.round(item.price * 100), // in tiyn / kopecks
        assortment: {
          meta: {
            href: isUuid
              ? `${API_URL}/entity/product/${item.id}`
              : `${API_URL}/entity/product/assortment`,
            type: 'product',
            mediaType: 'application/json',
          },
        },
      };
    });

    const isPaid = order.status === 'paid';
    const stateHref = isPaid ? STATE_CONFIRMED_HREF : STATE_NEW_HREF;

    // 4. Create CustomerOrder in MoySklad
    const orderPayload = {
      name: `№${order.id}`,
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
          href: stateHref,
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
    const createdOrderId = orderData.id;

    // 5. Create Task for Employee notification (Push notification in MoySklad app)
    let createdTaskId: string | undefined;
    try {
      const taskDescription = `🛒 Заказ №${order.id} на ${order.amount.toLocaleString('ru-RU')} ₸!
Получатель: ${order.customer.name}, тел: ${order.customer.phone}
Способ: ${deliveryTypeStr}
Статус: ${paymentStatusStr}`;

      const taskPayload = {
        description: taskDescription,
        assignee: {
          meta: {
            href: EMPLOYEE_HREF,
            type: 'employee',
            mediaType: 'application/json',
          },
        },
        operation: {
          meta: orderData.meta,
        },
      };

      const taskRes = await fetch(`${API_URL}/entity/task`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify(taskPayload),
      });

      if (taskRes.ok) {
        const taskData = await taskRes.json();
        createdTaskId = taskData.id;
      } else {
        console.warn('[MoySklad] Failed to create task notification:', await taskRes.text());
      }
    } catch (taskErr) {
      console.warn('[MoySklad] Task creation exception:', taskErr);
    }

    return {
      success: true,
      mode: 'live',
      moySkladOrderId: createdOrderId,
      moySkladTaskId: createdTaskId,
    };
  } catch (error: any) {
    console.error('[MoySklad] Error syncing order:', error);
    return { success: false, mode: 'live', error: error?.message || 'Unknown error' };
  }
}
