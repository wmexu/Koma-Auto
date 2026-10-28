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
import { client, isDbConfigured } from '@/db';
import { resolveAndEnsureUserId } from '@/lib/db-users';
import { isKillSwitchActive } from '@/lib/system-settings';

export async function POST(request: Request) {
  try {
    // 0. Emergency Kill-Switch Check
    const killSwitch = await isKillSwitchActive();
    if (killSwitch) {
      return NextResponse.json(
        { error: 'Приём заказов на сайте временно приостановлен администрацией магазина.' },
        { status: 503 }
      );
    }

    const body = await request.json();
    const {
      amount,
      name,
      phone,
      email,
      origin,
      deliveryMethod,
      city,
      comment,
      items,
      promoCode,
      userId,
      address,
      itemsPrice,
      deliveryCost,
    } = body;

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

        // Secure Production Promocode verification against Neon PostgreSQL
        if (promoCode && typeof promoCode === 'string' && isDbConfigured() && client) {
          try {
            const promoRows = await client`
              SELECT id, code, type, value, min_cart_total, max_discount, is_active, bound_emails, bound_user_id, usage_limit, used_count
              FROM promocodes
              WHERE LOWER(code) = LOWER(${promoCode.trim()}) AND is_active = true
              LIMIT 1;
            `;
            if (promoRows && promoRows.length > 0) {
              const p = promoRows[0];
              const minCart = Number(p.min_cart_total) || 0;
              const meetsMin = calculatedItemsTotal >= minCart;
              const notExhausted = !p.usage_limit || Number(p.used_count) < Number(p.usage_limit);

              const boundEmails: string[] = Array.isArray(p.bound_emails)
                ? p.bound_emails.map((e: any) => String(e).toLowerCase().trim())
                : [];
              const emailAllowed = boundEmails.length === 0 || (email && boundEmails.includes(email.toLowerCase().trim()));

              if (meetsMin && notExhausted && emailAllowed) {
                let discount = 0;
                if (p.type === 'percent') {
                  discount = (calculatedItemsTotal * Number(p.value)) / 100;
                  if (p.max_discount && discount > Number(p.max_discount)) {
                    discount = Number(p.max_discount);
                  }
                } else {
                  discount = Math.min(calculatedItemsTotal, Number(p.value));
                }
                calculatedItemsTotal = Math.max(0, calculatedItemsTotal - discount);
              }
            }
          } catch (promoErr) {
            console.warn('[Epay create-payment] Promocode verification notice:', promoErr);
          }
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

    // Guaranteed Pre-Insert into Neon PostgreSQL for instant CRM visibility
    if (isDbConfigured() && client) {
      try {
        const orderId = String(invoiceId);
        const customerEmail = (email || `customer_${orderId}@koma.kz`).toLowerCase().trim();
        const customerName = name || 'Покупатель';
        const customerPhone = phone || '';
        const cleanAddress = address || (deliveryMethod === 'courier' ? `г. ${city || 'Алматы'}` : 'Самовывоз: г. Алматы, Car City 1 ярус Подвал');
        const cleanCity = city || 'Алматы';

        const linkedUserId = await resolveAndEnsureUserId(
          userId || null,
          customerEmail,
          customerName,
          customerPhone
        );

        await client`
          INSERT INTO orders (
            id, invoice_id, user_id, amount, items_price, delivery_cost,
            delivery_method, payment_method, payment_status, fulfillment_status,
            customer_name, customer_phone, customer_email, delivery_address, city,
            items, warehouse_id, created_at, updated_at
          ) VALUES (
            ${orderId},
            ${orderId},
            ${linkedUserId},
            ${effectiveAmount},
            ${itemsPrice || effectiveAmount},
            ${deliveryCost || 0},
            ${deliveryMethod || 'pickup'},
            'online',
            'pending',
            'assembling',
            ${customerName},
            ${customerPhone},
            ${customerEmail},
            ${cleanAddress},
            ${cleanCity},
            ${JSON.stringify(items || [])}::jsonb,
            'car_city_podval',
            NOW(),
            NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            amount = EXCLUDED.amount,
            items_price = EXCLUDED.items_price,
            delivery_cost = EXCLUDED.delivery_cost,
            items = EXCLUDED.items,
            updated_at = NOW();
        `;
      } catch (neonErr) {
        console.error('[Epay create-payment] Postgres pre-insert error:', neonErr);
      }
    }

    // Mirror to Firestore
    try {
      const { db } = await import('@/lib/firebase');
      const { doc, setDoc } = await import('firebase/firestore');
      const orderData = {
        id: invoiceId,
        invoiceId: invoiceId,
        createdAt: new Date().toISOString(),
        expiresAt: new Date(Date.now() + 20 * 60 * 1000).toISOString(),
        status: 'pending',
        amount: effectiveAmount,
        itemsPrice: itemsPrice || effectiveAmount,
        deliveryCost: deliveryCost || 0,
        deliveryMethod: deliveryMethod || 'pickup',
        address: address || '',
        city: city || 'Алматы',
        customer: {
          name: name || 'Покупатель',
          phone: phone || '',
          email: email || '',
          comment: comment || '',
        },
        paymentMethod: 'online',
        items: items || [],
        userId: userId || null,
        isTestOrder: isTestOrder,
        promoCode: promoCode || undefined,
      };
      await setDoc(doc(db, 'orders', invoiceId), orderData, { merge: true }).catch(() => {});
    } catch (fbErr) {
      console.warn('[Epay create-payment] Firestore pre-insert warning:', fbErr);
    }

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
