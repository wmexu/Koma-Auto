import { NextResponse } from 'next/server';

const MOYSKLAD_API_URL = process.env.MOYSKLAD_API_URL || 'https://api.moysklad.ru/api/remap/1.2';
const MOYSKLAD_TOKEN = process.env.MOYSKLAD_TOKEN;

// Organization "КОМА АВТО"
const ORGANIZATION_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/organization/7909a58f-4aa7-11f1-0a80-1ac70019f4ae';
// CustomerOrder state "Новый"
const STATE_NEW_HREF = 'https://api.moysklad.ru/api/remap/1.2/entity/customerorder/metadata/states/79218f4f-4aa7-11f1-0a80-1ac70019f4ef';

function getHeaders() {
  return {
    Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
    'Content-Type': 'application/json',
    Accept: 'application/json;charset=utf-8',
    'Accept-Encoding': 'gzip',
  };
}

function getGetHeaders() {
  return {
    Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
    Accept: 'application/json;charset=utf-8',
    'Accept-Encoding': 'gzip',
  };
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { name, phone, vin, clientInfo } = body;

    if (!phone) {
      return NextResponse.json({ error: 'Пожалуйста, укажите номер телефона' }, { status: 400 });
    }

    if (!MOYSKLAD_TOKEN) {
      console.error('MOYSKLAD_TOKEN is not defined');
      return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }

    // Clean and normalize phone number
    const cleanDigits = (phone || '').replace(/\D/g, '');
    const searchPhone = cleanDigits.length >= 10 ? cleanDigits.slice(-10) : cleanDigits;
    const formattedPhone = cleanDigits.length === 11 && cleanDigits.startsWith('7')
      ? `+${cleanDigits}`
      : cleanDigits.length === 10
      ? `+7${cleanDigits}`
      : phone;

    // 1. Find or create counterparty in MoySklad
    let counterpartyHref = '';
    if (searchPhone) {
      try {
        const searchRes = await fetch(
          `${MOYSKLAD_API_URL}/entity/counterparty?filter=phone~=${encodeURIComponent(searchPhone)}&limit=1`,
          { headers: getGetHeaders() }
        );
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.rows && searchData.rows.length > 0) {
            counterpartyHref = searchData.rows[0].meta?.href;
          }
        }
      } catch (e) {
        console.warn('[Consultation API] Counterparty search failed:', e);
      }
    }

    if (!counterpartyHref) {
      try {
        const createRes = await fetch(`${MOYSKLAD_API_URL}/entity/counterparty`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            name: name ? name.trim() : `Клиент ${formattedPhone}`,
            phone: formattedPhone,
            description: `Создан автоматически из формы онлайн-консультации koma.com.kz`,
          }),
        });

        if (createRes.ok) {
          const createdData = await createRes.json();
          counterpartyHref = createdData.meta?.href;
        }
      } catch (cpErr) {
        console.warn('[Consultation API] Counterparty creation failed:', cpErr);
      }
    }

    const description = `ЗАПРОС КОНСУЛЬТАЦИИ С САЙТА

Имя клиента: ${name || 'Не указано'}
Телефон: ${formattedPhone}
VIN / Номер кузова: ${vin || 'Не указан'}

${clientInfo || 'Клиент: Гость'}

Пожалуйста, свяжитесь с клиентом для консультации и подбора автозапчастей.`;

    // 2. Create CustomerOrder in MoySklad in "Заказы покупателей"
    const orderPayload: any = {
      name: 'Консультация',
      description,
      organization: {
        meta: {
          href: ORGANIZATION_HREF,
          type: 'organization',
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
    };

    if (counterpartyHref) {
      orderPayload.agent = {
        meta: {
          href: counterpartyHref,
          type: 'counterparty',
          mediaType: 'application/json',
        },
      };
    }

    const orderResponse = await fetch(`${MOYSKLAD_API_URL}/entity/customerorder`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(orderPayload),
    });

    if (!orderResponse.ok) {
      const errText = await orderResponse.text();
      console.error('[Consultation API] Failed to create customer order in MoySklad:', orderResponse.status, errText);
      return NextResponse.json({ error: 'Failed to create consultation order' }, { status: orderResponse.status });
    }

    const orderData = await orderResponse.json();
    return NextResponse.json({ success: true, orderId: orderData.id });
  } catch (error) {
    console.error('Error in consultation API:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
