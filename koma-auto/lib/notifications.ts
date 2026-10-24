import dns from 'node:dns';
if (typeof dns.setDefaultResultOrder === 'function') {
  try { dns.setDefaultResultOrder('ipv4first'); } catch {}
}
import { Order } from './order-types';

/**
 * Formats a clean, concise, senior-developer order report containing
 * all field data and user account details without AI fluff.
 */
export function formatOrderReport(order: Order): string {
  const isCourier = order.deliveryMethod === 'courier';
  const deliveryLabel = isCourier
    ? 'Курьерская доставка'
    : 'Самовывоз (г. Алматы, Car City 1 ярус Подвал)';

  const userAccountStr = order.userAccountDetails
    ? `Зарегистрирован на сайте (UID: ${order.userAccountDetails.uid}${order.userAccountDetails.email ? `, Email: ${order.userAccountDetails.email}` : ''})`
    : 'Гостевой заказ (без авторизации)';

  const itemsList = order.items && order.items.length > 0
    ? order.items
        .map((item, idx) => {
          const oem = item.oem || item.article || '—';
          const article = item.article || item.oem || '—';
          const brand = item.brand || '—';
          const meta = ` [OEM: ${oem}, Артикул: ${article}, Бренд: ${brand}]`;
          const lineTotal = item.quantity * item.price;
          return `${idx + 1}. ${item.name}${meta}\n   ${item.quantity} шт. × ${item.price.toLocaleString('ru-RU')} ₸ = ${lineTotal.toLocaleString('ru-RU')} ₸`;
        })
        .join('\n')
    : '1. Автозапчасти по заказу\n   1 шт. × ' + order.amount.toLocaleString('ru-RU') + ' ₸ = ' + order.amount.toLocaleString('ru-RU') + ' ₸';

  const deliveryCostStr = order.deliveryCost > 0
    ? `${order.deliveryCost.toLocaleString('ru-RU')} ₸`
    : 'Бесплатно';
  const receiptUrl = order.receiptUrl || `https://epay.homebank.kz/receipt/${order.id}`;
  const statusLabel = order.status === 'paid' ? 'Оплачено' : 'Ожидает оплаты';
  const commentStr = order.isTestOrder ? 'ТЕСТОВЫЙ ЗАКАЗ. ИГНОРИРУЙТЕ' : (order.customer.comment || 'Нет');
  const totalLabel = order.status === 'paid' ? 'ИТОГО ОПЛАЧЕНО' : 'ИТОГО К ОПЛАТЕ';

  const paymentMethodLabel = order.paymentMethod === 'kaspi_pay'
    ? 'Kaspi Pay (Дистанционная оплата по номеру телефона)'
    : order.paymentMethod === 'online'
    ? 'Онлайн-оплата (Halyk ePay)'
    : order.paymentMethod === 'cash'
    ? 'Наличными при получении'
    : 'Банковской картой при получении';

  const kaspiPhonePrefix = order.paymentMethod === 'kaspi_pay' ? `Номер телефона для отправки платежа Kaspi: ${order.kaspiPhone || order.customer.phone}\n\n` : '';
  return `${kaspiPhonePrefix}ЗАКАЗ №${order.id}: ${statusLabel}

Оплата:
• Способ: ${paymentMethodLabel}

Клиент:
• Имя в заказе: ${order.customer.name}
• Телефон: ${order.customer.phone}
• Email: ${order.customer.email || 'Не указан'}
• Аккаунт: ${userAccountStr}

Доставка:
• Способ: ${deliveryLabel}
• Адрес: ${order.address}
• Город: ${order.city || '—'}
• Комментарий: ${commentStr}

Состав заказа: (${order.items?.length || 1} поз.)
${itemsList}

Суммирование
• Сумма товаров: ${order.itemsPrice.toLocaleString('ru-RU')} ₸
• Доставка: ${deliveryCostStr}
${order.promoCode ? `• Промокод: ${order.promoCode}\n` : ''}• ${totalLabel}: ${order.amount.toLocaleString('ru-RU')} ₸
• Платежный шлюз: Halyk ePay
• Чек ePay: ${receiptUrl}
Дата и время: ${new Date(order.createdAt).toLocaleString('ru-RU', { timeZone: 'Asia/Almaty' })}`;
}

/**
 * Sends push notifications across configured channels (Telegram bot, Webhooks)
 */
export async function sendOrderPushNotification(order: Order): Promise<{ success: boolean; channels: string[] }> {
  const message = formatOrderReport(order);
  const channels: string[] = [];

  // 1. Telegram Notification (Direct instant push to store manager / channel)
  const tgToken = process.env.TELEGRAM_BOT_TOKEN;
  const tgChatId = process.env.TELEGRAM_CHAT_ID;

  if (tgToken && tgChatId) {
    try {
      const tgRes = await fetch(`https://api.telegram.org/bot${tgToken}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: tgChatId,
          text: message,
          disable_web_page_preview: true,
        }),
      });

      if (tgRes.ok) {
        channels.push('telegram');
        console.log(`[Notification] Telegram push sent for order #${order.id}`);
      } else {
        const tgErr = await tgRes.text();
        console.error(`[Notification] Telegram failed: ${tgRes.status} ${tgErr}`);
      }
    } catch (e) {
      console.error('[Notification] Telegram request exception:', e);
    }
  }

  // 2. Generic Webhook (if configured)
  const webhookUrl = process.env.ORDER_WEBHOOK_URL;
  if (webhookUrl) {
    try {
      const whRes = await fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          event: 'order.paid',
          order,
          report: message,
        }),
      });
      if (whRes.ok) {
        channels.push('webhook');
        console.log(`[Notification] Webhook push sent for order #${order.id}`);
      }
    } catch (e) {
      console.error('[Notification] Webhook request exception:', e);
    }
  }

  return { success: channels.length > 0, channels };
}
