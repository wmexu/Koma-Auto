import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { verifyStaffSession } from '@/lib/admin-auth';
import { logAuditEvent } from '@/lib/audit';
import crypto from 'node:crypto';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const auth = await verifyStaffSession(request, ['director']);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    const rows = await client`
      SELECT 
        d.id,
        d.product_id,
        d.discount_type,
        d.value_type,
        d.discount_value,
        d.original_price,
        d.discounted_price,
        d.display_old_price,
        d.created_at,
        p.title,
        p.brand,
        p.original_oem,
        p.image,
        p.stock_quantity,
        p.in_stock
      FROM discounted_products d
      JOIN my_sklad_products p ON d.product_id = p.id

      UNION ALL

      SELECT
        ('legacy_' || p.id) as id,
        p.id as product_id,
        'marketing' as discount_type,
        'fixed' as value_type,
        (p.old_price - p.price) as discount_value,
        p.price as original_price,
        p.price as discounted_price,
        p.old_price as display_old_price,
        COALESCE(p.updated_at, NOW()) as created_at,
        p.title,
        p.brand,
        p.original_oem,
        p.image,
        p.stock_quantity,
        p.in_stock
      FROM my_sklad_products p
      WHERE p.old_price IS NOT NULL 
        AND p.old_price > p.price
        AND NOT EXISTS (SELECT 1 FROM discounted_products dp WHERE dp.product_id = p.id)
      ORDER BY created_at DESC;
    `;

    return NextResponse.json({ success: true, discounts: rows });
  } catch (error: any) {
    console.error('[Discounts API Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка загрузки скидок' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { productIds, discountType, valueType, discountValue, staffUserId } = body;

    const auth = await verifyStaffSession(request, ['director'], staffUserId);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!Array.isArray(productIds) || productIds.length === 0) {
      return NextResponse.json({ error: 'Не выбраны товары для скидки' }, { status: 400 });
    }

    if (discountType !== 'real' && discountType !== 'marketing') {
      return NextResponse.json({ error: 'Неверный тип скидки' }, { status: 400 });
    }

    if (valueType !== 'percent' && valueType !== 'fixed') {
      return NextResponse.json({ error: 'Неверный формат скидки' }, { status: 400 });
    }

    const numValue = Number(discountValue);
    if (isNaN(numValue) || numValue <= 0) {
      return NextResponse.json({ error: 'Укажите положительный размер скидки' }, { status: 400 });
    }

    // Strict safety limits
    if (discountType === 'real' && valueType === 'percent' && numValue > 20) {
      return NextResponse.json({ error: 'Настоящая скидка не может превышать 20%' }, { status: 400 });
    }

    if (discountType === 'marketing' && valueType === 'percent' && numValue > 100) {
      return NextResponse.json({ error: 'Маркетинговая скидка не может превышать 100%' }, { status: 400 });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    // Fetch existing product data
    const products = await client`
      SELECT id, title, price, old_price
      FROM my_sklad_products
      WHERE id = ANY(${productIds});
    `;

    if (!products || products.length === 0) {
      return NextResponse.json({ error: 'Выбранные товары не найдены' }, { status: 404 });
    }

    // Process each product and enforce limits
    const results = [];
    for (const p of products) {
      const origPrice = Number(p.price) || 0;
      let diff = 0;

      if (valueType === 'percent') {
        diff = Math.round(origPrice * (numValue / 100));
      } else {
        diff = Math.round(numValue);
      }

      // Check max fixed limits
      if (discountType === 'real') {
        if (diff > origPrice * 0.20) {
          return NextResponse.json({
            error: `Скидка для товара "${p.title}" превышает лимит 20% (максимум: ${Math.round(origPrice * 0.20)} ₸)`,
          }, { status: 400 });
        }
      } else {
        if (diff > origPrice * 1.0) {
          return NextResponse.json({
            error: `Маркетинговая скидка для товара "${p.title}" превышает лимит 100% (максимум: ${Math.round(origPrice * 1.0)} ₸)`,
          }, { status: 400 });
        }
      }

      let discountedPrice = origPrice;
      let displayOldPrice = null;

      if (discountType === 'real') {
        discountedPrice = Math.max(1, origPrice - diff);
        displayOldPrice = origPrice;
      } else {
        // Marketing discount: real store price stays the same, old price is displayed higher
        discountedPrice = origPrice;
        displayOldPrice = origPrice + diff;
      }

      const discountId = crypto.randomUUID();

      // Upsert discount
      await client`
        INSERT INTO discounted_products (
          id, product_id, discount_type, value_type, discount_value,
          original_price, discounted_price, display_old_price, created_at, updated_at
        ) VALUES (
          ${discountId},
          ${p.id},
          ${discountType},
          ${valueType},
          ${numValue},
          ${origPrice},
          ${discountedPrice},
          ${displayOldPrice},
          NOW(),
          NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          discount_type = EXCLUDED.discount_type,
          value_type = EXCLUDED.value_type,
          discount_value = EXCLUDED.discount_value,
          original_price = EXCLUDED.original_price,
          discounted_price = EXCLUDED.discounted_price,
          display_old_price = EXCLUDED.display_old_price,
          updated_at = NOW();
      `;

      // Update product in catalog
      await client`
        UPDATE my_sklad_products
        SET
          price = ${discountedPrice},
          old_price = ${displayOldPrice},
          updated_at = NOW()
        WHERE id = ${p.id};
      `;

      results.push({
        id: p.id,
        title: p.title,
        originalPrice: origPrice,
        discountedPrice,
        displayOldPrice,
      });
    }

    logAuditEvent({
      userId: auth.user?.id || staffUserId || null,
      action: 'DISCOUNT_CREATED',
      entityType: 'discount',
      entityId: productIds.join(','),
      details: { count: results.length, discountType, valueType, discountValue },
    });

    return NextResponse.json({ success: true, count: results.length, results });
  } catch (error: any) {
    console.error('[Discounts API POST Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка создания скидки' }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');
    const productId = searchParams.get('productId');
    const staffUserId = searchParams.get('staffUserId') || undefined;

    const auth = await verifyStaffSession(request, ['director'], staffUserId);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!id && !productId) {
      return NextResponse.json({ error: 'Не указан ID скидки' }, { status: 400 });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    const isLegacy = typeof id === 'string' && id.startsWith('legacy_');
    const targetProductId = isLegacy ? id.replace('legacy_', '') : productId;

    if (isLegacy || (!id && targetProductId)) {
      await client`
        UPDATE my_sklad_products
        SET old_price = NULL, updated_at = NOW()
        WHERE id = ${targetProductId};
      `;
      await client`
        DELETE FROM discounted_products WHERE product_id = ${targetProductId};
      `;

      logAuditEvent({
        userId: auth.user?.id || staffUserId || null,
        action: 'DISCOUNT_DELETED',
        entityType: 'discount',
        entityId: id || targetProductId || '',
        details: { productId: targetProductId, legacy: true },
      });

      return NextResponse.json({ success: true, message: 'Скидка успешно отменена' });
    }

    // Find the discount row
    let rows: any[] = [];
    if (id) {
      rows = await client`
        SELECT id, product_id, original_price FROM discounted_products WHERE id = ${id} LIMIT 1;
      `;
    } else if (productId) {
      rows = await client`
        SELECT id, product_id, original_price FROM discounted_products WHERE product_id = ${productId} LIMIT 1;
      `;
    }

    if (!rows || rows.length === 0) {
      // Revert if product has old_price in my_sklad_products
      if (id) {
        await client`
          UPDATE my_sklad_products SET old_price = NULL, updated_at = NOW() WHERE id = ${id};
        `;
      }
      return NextResponse.json({ success: true, message: 'Скидка успешно отменена' });
    }

    const row = rows[0];

    // Revert price in my_sklad_products
    await client`
      UPDATE my_sklad_products
      SET 
        price = ${row.original_price},
        old_price = NULL,
        updated_at = NOW()
      WHERE id = ${row.product_id};
    `;

    // Delete discount row
    await client`
      DELETE FROM discounted_products WHERE id = ${row.id};
    `;

    logAuditEvent({
      userId: auth.user?.id || staffUserId || null,
      action: 'DISCOUNT_DELETED',
      entityType: 'discount',
      entityId: row.id,
      details: { productId: row.product_id, revertedPrice: row.original_price },
    });

    return NextResponse.json({ success: true, message: 'Скидка успешно отменена' });
  } catch (error: any) {
    console.error('[Discounts API DELETE Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка удаления скидки' }, { status: 500 });
  }
}
