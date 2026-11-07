import { NextResponse } from 'next/server';
import { checkGeneralRateLimit } from '@/lib/rate-limiter';
import { sendConsultationTelegramNotification } from '@/lib/notifications';

export async function POST(request: Request) {
  try {
    const ip = request.headers.get('x-forwarded-for') || 'unknown-ip';
    const rateCheck = checkGeneralRateLimit(ip, 5, 10 * 60 * 1000);
    if (!rateCheck.allowed) {
      return NextResponse.json(
        { error: `Слишком много запросов. Пожалуйста, повторите через ${rateCheck.remainingSeconds || 600} сек.` },
        { status: 429 }
      );
    }

    const body = await request.json();
    const { name, phone, vin, clientInfo } = body;

    if (!phone) {
      return NextResponse.json({ error: 'Пожалуйста, укажите номер телефона' }, { status: 400 });
    }

    // Clean and normalize phone number
    const cleanDigits = (phone || '').replace(/\D/g, '');
    const formattedPhone = cleanDigits.length === 11 && cleanDigits.startsWith('7')
      ? `+${cleanDigits}`
      : cleanDigits.length === 10
      ? `+7${cleanDigits}`
      : phone;

    // Send instant push notification to Telegram channel (MoySklad is skipped per business requirement)
    await sendConsultationTelegramNotification({
      name: name ? String(name).trim() : undefined,
      phone: formattedPhone,
      vin: vin ? String(vin).trim() : undefined,
      clientInfo: clientInfo ? String(clientInfo).trim() : undefined,
    });

    return NextResponse.json({ success: true, message: 'Заявка на консультацию успешно отправлена' });
  } catch (error) {
    console.error('Error in consultation API:', error);
    return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
  }
}
