import { NextResponse } from 'next/server';
import {
  generateInvoiceId,
  generateSecretHash,
  getEpayToken,
  buildDirectPaymentUrl,
  transliterate,
  EpayPaymentObject,
} from '@/lib/epay';
import { getTestPromoConfig } from '@/lib/promocode';
import { getProductsByIdsFromDb } from '@/lib/products-db';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { amount, name, phone, email, origin, deliveryMethod, city, comment, items, promoCode } = body;

    const testPromo = getTestPromoConfig(promoCode);
    const isTestOrder = Boolean(testPromo);

    

    // Secure Price & Stock Verification:
    // If test order, use strict test promo target price (10, 50, or 100 ₸).
    // If live order, verify genuine item prices directly from Neon PostgreSQL and enforce inventory stock limits.
    let effectiveAmount = 0;

    if (testPromo) {
      effectiveAmount = testPromo.targetPrice;
    } else {
      if (Array.isArray(items) && items.length > 0) {
        const itemIds = items.map((i: any) => i.id).filter(Boolean);
        const dbProducts = await getProductsByIdsFromDb(itemIds);
        const productMap = new Map(dbProducts.map((p) => [p.id, p]));

        // Enforce inventory stock check
        for (const item of items) {
          const dbItem = productMap.get(item.id);
          const requestedQty = Math.max(1, Number(item.quantity) || 1);
          if (dbItem) {
            if (dbItem.stock_quantity < requestedQty) {
              return NextResponse.json(
                {
                  error: `Товара "${dbItem.title}" недостаточно на складе Car City. В наличии: ${dbItem.stock_quantity} шт., запрошено: ${requestedQty} шт. Пожалуйста, скорректируйте количество в корзине.`,
                },
                { status: 400 }
              );
            }
          }
        }

        let calculatedItemsTotal = 0;
        for (const item of items) {
          const dbItem = productMap.get(item.id);
          const genuinePrice = dbItem ? dbItem.price : (Number(item.price) || 0);
          const qty = Math.max(1, Number(item.quantity) || 1);
          calculatedItemsTotal += genuinePrice * qty;
        }

        const isCourier = deliveryMethod === 'courier';
        const isAlmaty = (city || '').toLowerCase().includes('алмат');
        const deliveryFee = (isCourier && isAlmaty && calculatedItemsTotal < 20000) ? 6500 : 0;

        effectiveAmount = Math.round(calculatedItemsTotal + deliveryFee);
      } else {
        effectiveAmount = Math.round(Number(amount) || 0);
      }
    }

    if (!effectiveAmount || effectiveAmount <= 0) {
      return NextResponse.json({ error: 'Сумма заказа должна быть больше нуля' }, { status: 400 });
    }

    if (!phone) {
      return NextResponse.json({ error: 'Телефон обязателен для оформления' }, { status: 400 });
    }

    const terminal = process.env.HALYK_EPAY_TERMINAL_ID;
    const clientSecret = process.env.HALYK_EPAY_CLIENT_SECRET;

    if (!terminal || !clientSecret) {
      console.error('Halyk ePay credentials are missing in environment variables');
      return NextResponse.json({ error: 'Платежная система временно недоступна (не настроен терминал)' }, { status: 500 });
    }

    const invoiceId = generateInvoiceId();
    const secretHash = generateSecretHash(invoiceId, clientSecret);

    // Determine return and webhook links
    const clientOrigin = origin || process.env.NEXT_PUBLIC_SITE_URL || 'https://koma.com.kz';
    const backLink = `${clientOrigin}/checkout/success?orderId=${invoiceId}&status=success`;
    const failureBackLink = `${clientOrigin}/checkout?orderId=${invoiceId}&status=fail`;

    // Note: ePay webhook postLink must be accessible over the internet
    const isLocal = clientOrigin.includes('localhost') || clientOrigin.includes('192.168.') || clientOrigin.includes('127.0.0.1');
    const postLink = isLocal
      ? 'https://koma.com.kz/api/epay/postlink'
      : `${clientOrigin}/api/epay/postlink`;

    // 1. Fetch token from Halyk ePay
    const tokenData = await getEpayToken({
      invoiceId,
      amount: effectiveAmount,
      secretHash,
      postLink,
      failurePostLink: postLink,
    });

    const latinName = transliterate(name || 'Customer');
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';

    const description = isTestOrder
      ? `[ТЕСТ] Проверка ePay №${invoiceId}`.substring(0, 120)
      : `Оплата заказа №${invoiceId} в koma.com.kz`.substring(0, 120);

    // 2. Assemble payment object according to Halyk ePay specification
    const paymentObject: EpayPaymentObject = {
      invoiceId,
      invoiceIdAlt: invoiceId,
      backLink,
      failureBackLink,
      autoBackLink: true,
      postLink,
      failurePostLink: postLink,
      language: 'rus',
      description,
      terminal,
      amount: effectiveAmount,
      currency: 'KZT',
      phone: cleanPhone || undefined,
      name: latinName || undefined,
      email: email || undefined,
      auth: tokenData,
    };

    // 3. Generate direct payment URL for fallback or direct navigation
    const paymentUrl = buildDirectPaymentUrl(paymentObject);

    return NextResponse.json({
      success: true,
      invoiceId,
      paymentObject,
      paymentUrl,
    });
  } catch (error: any) {
    console.error('Error creating Halyk ePay payment:', error);
    return NextResponse.json(
      { error: error?.message || 'Ошибка инициализации платежа ePay' },
      { status: 500 }
    );
  }
}
