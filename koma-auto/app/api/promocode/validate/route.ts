import { NextResponse } from 'next/server';
import { getTestPromoConfig, getTestPromoDisclaimer } from '@/lib/promocode';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const code = (body?.code || '').trim();

    if (!code) {
      return NextResponse.json({ valid: false, error: 'Введите промокод' }, { status: 400 });
    }

    const testPromo = getTestPromoConfig(code);

    if (testPromo) {
      return NextResponse.json({
        valid: true,
        isTestMode: true,
        targetPrice: testPromo.targetPrice,
        code,
        title: testPromo.title,
        disclaimer: getTestPromoDisclaimer(testPromo.targetPrice),
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
