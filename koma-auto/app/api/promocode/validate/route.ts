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
    const clientType = body?.clientType || 'retail';

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
        message: `Тестовый промокод «${code}» активирован. Сумма заказа снижена до ${testPromo.targetPrice} ₸`,
        disclaimer: getTestPromoDisclaimer(testPromo.targetPrice),
      });
    }

    // 2. Check production promocodes in Neon PostgreSQL
    if (isDbConfigured() && client) {
      const rows = await client`
        SELECT 
          id, code, type, value, min_cart_total, max_cart_total, max_discount,
          target_audience, bound_user_id, bound_emails, usage_limit, used_count, is_active
        FROM promocodes
        WHERE LOWER(code) = LOWER(${code})
        LIMIT 1;
      `;

      if (rows && rows.length > 0) {
        const p = rows[0];

        if (!p.is_active) {
          return NextResponse.json({ 
            valid: false, 
            error: `Промокод «${p.code}» деактивирован администрацией.` 
          }, { status: 400 });
        }

        if (p.usage_limit && Number(p.used_count) >= Number(p.usage_limit)) {
          return NextResponse.json({ 
            valid: false, 
            error: `Лимит использований промокода «${p.code}» исчерпан.` 
          }, { status: 400 });
        }

        const minCart = Number(p.min_cart_total) || 0;
        if (minCart > 0 && cartTotal < minCart) {
          return NextResponse.json({
            valid: false,
            error: `Сумма вашей корзины слишком маленькая (минимум ${minCart.toLocaleString('ru-RU')} тенге). Промокод ${p.code} не применен`,
          }, { status: 400 });
        }

        const maxCart = p.max_cart_total ? Number(p.max_cart_total) : null;
        if (maxCart && maxCart > 0 && cartTotal > maxCart) {
          return NextResponse.json({
            valid: false,
            error: `Сумма вашей корзины слишком большая (до ${maxCart.toLocaleString('ru-RU')} тенге). Промокод ${p.code} не применен`,
          }, { status: 400 });
        }

        // Email binding check
        const boundEmails: string[] = Array.isArray(p.bound_emails) 
          ? p.bound_emails.map((e: any) => String(e).toLowerCase().trim()) 
          : [];

        if (boundEmails.length > 0) {
          if (!userEmail) {
            return NextResponse.json({
              valid: false,
              error: 'Этот промокод привязан к отдельному аккаунту. Войдите в свой профиль для его использования.',
            }, { status: 403 });
          }
          if (!boundEmails.includes(userEmail)) {
            return NextResponse.json({
              valid: false,
              error: `Этот промокод привязан к отдельному аккаунту. Промокод ${p.code} не применен`,
            }, { status: 403 });
          }
        } else if (p.bound_user_id) {
          // Fallback to bound_user_id only if bound_emails is empty
          if (!userId && !userEmail) {
            return NextResponse.json({
              valid: false,
              error: 'Этот промокод привязан к отдельному аккаунту. Войдите в свой профиль для его использования.',
            }, { status: 403 });
          }
          if (userId && String(p.bound_user_id) !== String(userId)) {
            return NextResponse.json({
              valid: false,
              error: `Этот промокод привязан к другому профилю. Промокод ${p.code} не применен`,
            }, { status: 403 });
          }
        }

        // Target audience check
        if (p.target_audience === 'wholesale' && clientType !== 'wholesale') {
          return NextResponse.json({
            valid: false,
            error: `Этот промокод доступен только для оптовых покупателей. Промокод ${p.code} не применен`,
          }, { status: 403 });
        }
        if (p.target_audience === 'retail' && clientType === 'wholesale') {
          return NextResponse.json({
            valid: false,
            error: `Этот промокод доступен только для розничных покупателей. Промокод ${p.code} не применен`,
          }, { status: 403 });
        }

        const numVal = Number(p.value);
        const maxDisc = p.max_discount ? Number(p.max_discount) : null;
        let discountAmount = 0;

        if (p.type === 'percent') {
          discountAmount = Math.round((cartTotal * numVal) / 100);
          if (maxDisc && discountAmount > maxDisc) {
            discountAmount = maxDisc;
          }
        } else {
          discountAmount = Math.min(cartTotal, numVal);
        }

        const successMessage = p.type === 'percent'
          ? `Промокод ${p.code} применен. Активирована ${numVal}% скидка`
          : `Промокод ${p.code} применен. Активирована ${numVal.toLocaleString('ru-RU')} тенге скидка`;

        return NextResponse.json({
          valid: true,
          code: p.code,
          type: p.type,
          value: numVal,
          discountAmount,
          minCartTotal: minCart,
          maxCartTotal: maxCart,
          maxDiscount: maxDisc,
          message: successMessage,
          title: successMessage,
        });
      }
    }

    return NextResponse.json({
      valid: false,
      error: `Промокод «${code}» не найден или срок его действия истёк.`
    }, { status: 400 });
  } catch (error: any) {
    console.error('Error validating promocode:', error);
    return NextResponse.json({ valid: false, error: 'Ошибка при проверке промокода' }, { status: 500 });
  }
}
