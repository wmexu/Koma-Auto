import { NextResponse } from 'next/server';
import { getTestPromoConfig, getTestPromoDisclaimer } from '@/lib/promocode';
import { client, isDbConfigured } from '@/db';

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const code = (body?.code || '').trim();
    const cartTotal = Number(body?.cartTotal) || 0;
    const userEmail = (body?.userEmail || '').trim().toLowerCase();
    const userId = body?.userId || null;

    if (!code) {
      return NextResponse.json({ valid: false, error: 'Введите промокод' }, { status: 400 });
    }

    // 1. Check test promo codes
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

    // 2. Check production promocodes in Neon PostgreSQL
    if (isDbConfigured() && client) {
      const rows = await client`
        SELECT id, code, type, value, min_cart_total, max_discount, target_audience, bound_user_id, bound_emails, usage_limit, used_count, is_active
        FROM promocodes
        WHERE LOWER(code) = LOWER(${code})
        LIMIT 1;
      `;

      if (rows && rows.length > 0) {
        const p = rows[0];

        if (!p.is_active) {
          return NextResponse.json({ valid: false, error: 'Данный промокод деактивирован' }, { status: 400 });
        }

        if (p.usage_limit && Number(p.used_count) >= Number(p.usage_limit)) {
          return NextResponse.json({ valid: false, error: 'Лимит использований данного промокода исчерпан' }, { status: 400 });
        }

        const minCart = Number(p.min_cart_total) || 0;
        if (cartTotal > 0 && cartTotal < minCart) {
          return NextResponse.json({
            valid: false,
            error: `Минимальная сумма заказа для применения промокода: ${minCart.toLocaleString('ru-RU')} ₸`,
          }, { status: 400 });
        }

        // Email binding check
        const boundEmails: string[] = Array.isArray(p.bound_emails) ? p.bound_emails.map((e: any) => String(e).toLowerCase().trim()) : [];
        if (boundEmails.length > 0) {
          if (!userEmail || !boundEmails.includes(userEmail)) {
            return NextResponse.json({
              valid: false,
              error: 'Этот промокод привязан к определенному аккаунту. Войдите в свой профиль для его использования.',
            }, { status: 403 });
          }
        }

        // User ID binding check
        if (p.bound_user_id && userId && String(p.bound_user_id) !== String(userId)) {
          return NextResponse.json({
            valid: false,
            error: 'Этот промокод привязан к другому профилю.',
          }, { status: 403 });
        }

        const numVal = Number(p.value);
        const maxDisc = p.max_discount ? Number(p.max_discount) : null;
        const title = p.type === 'percent'
          ? `Скидка ${numVal}%${maxDisc ? ` (макс. ${maxDisc.toLocaleString('ru-RU')} ₸)` : ''}`
          : `Скидка ${numVal.toLocaleString('ru-RU')} ₸`;

        return NextResponse.json({
          valid: true,
          code: p.code,
          type: p.type,
          value: numVal,
          minCartTotal: minCart,
          maxDiscount: maxDisc,
          title,
        });
      }
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
