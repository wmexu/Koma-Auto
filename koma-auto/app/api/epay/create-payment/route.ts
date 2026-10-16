import { NextResponse } from 'next/server';
import {
  generateInvoiceId,
  generateSecretHash,
  getEpayToken,
  buildDirectPaymentUrl,
  transliterate,
  EpayPaymentObject,
} from '@/lib/epay';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { amount, name, phone, email, origin, deliveryMethod, city, comment, items } = body;

    if (!amount || amount <= 0) {
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
      amount: Math.round(amount),
      secretHash,
      postLink,
      failurePostLink: postLink,
    });

    const latinName = transliterate(name || 'Customer');
    const cleanPhone = phone ? phone.replace(/\D/g, '') : '';

    const description = `Оплата заказа №${invoiceId} в koma.com.kz`.substring(0, 120);

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
      amount: Math.round(amount),
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
