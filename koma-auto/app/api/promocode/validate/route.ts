import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const code = (body?.code || '').trim();

    if (!code) {
      return NextResponse.json({ valid: false, error: 'Введите промокод' }, { status: 400 });
    }

    const testPromoCode = (process.env.TEST_ORDER_PROMO_CODE || '').trim();

    if (testPromoCode && code === testPromoCode) {
      return NextResponse.json({
        valid: true,
        isTestMode: true,
        targetPrice: 1,
        code: testPromoCode,
        title: 'Служебный тестовый режим (1 ₸)',
        disclaimer: 'ВНИМАНИЕ: АКТИВИРОВАН РЕЖИМ ТЕХНИЧЕСКОГО ТЕСТИРОВАНИЯ. Сумма заказа снижена до 1 ₸ для верификации соединения с процессингом Halyk ePay. Данный заказ носит исключительно демонстрационно-технический характер, не является публичной офертой и не создает обязательств по передаче товаров (ст. 447, 449 ГК РК).'
      });
    }

    return NextResponse.json({
      valid: false,
      error: 'Промокод не найден или срок его действия истёк'
    }, { status: 400 });
  } catch (error: any) {
    console.error('Error validating promocode:', error);
    return NextResponse.json({ valid: false, error: 'Ошибка при проверке промокода' }, { status: 500 });
  }
}
