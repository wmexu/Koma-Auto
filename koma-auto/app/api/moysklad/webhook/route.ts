import { NextResponse } from 'next/server';
import { cancelAndRefundOrder } from '@/lib/order-cancellation';
import { client, isDbConfigured } from '@/db';
import { normalizeBrand } from '@/lib/brand-utils';

const TOKEN = process.env.MOYSKLAD_TOKEN;

function getMoySkladHeaders() {
  return {
    Authorization: `Bearer ${TOKEN}`,
    Accept: 'application/json;charset=utf-8',
    'Accept-Encoding': 'gzip',
  };
}

/**
 * High-speed synchronization of an updated or newly created product into Neon Postgres
 */
async function syncProductFromMoySklad(productHref: string, sql: any) {
  try {
    const res = await fetch(`${productHref}?expand=images,supplier`, {
      headers: getMoySkladHeaders(),
    });

    if (!res.ok) {
      console.warn(`[Sync Webhook] Failed to fetch product ${productHref}: ${res.status}`);
      return;
    }

    const p = await res.json();
    const productId = p.id;
    if (!productId) return;

    // Extract price
    let price = 0;
    if (Array.isArray(p.salePrices) && p.salePrices.length > 0) {
      const defaultPrice =
        p.salePrices.find((sp: any) => sp.priceType?.name === 'Цена продажи') || p.salePrices[0];
      price = (defaultPrice?.value || 0) / 100;
    }

    // Extract OEM
    const rawOem = p.code || p.article || '';
    const cleanOem = rawOem.replace(/[\s\-\.]/g, '').toUpperCase();

    // Extract Brand
    const brandInfo = normalizeBrand(p.supplier?.name, rawOem);

    // Extract Images
    let image = '';
    let images: string[] = [];
    if (p.images && p.images.rows && p.images.rows.length > 0) {
      const first = p.images.rows[0];
      if (first.meta?.downloadHref) {
        image = `/api/images?href=${encodeURIComponent(first.meta.downloadHref)}`;
      }
      images = p.images.rows
        .map((img: any) =>
          img.meta?.downloadHref ? `/api/images?href=${encodeURIComponent(img.meta.downloadHref)}` : ''
        )
        .filter((url: string) => url !== '');
    }

    // Extract specs from attributes
    const specs: Record<string, string> = {};
    if (Array.isArray(p.attributes)) {
      p.attributes.forEach((attr: any) => {
        if (attr.name && attr.name.toLowerCase() !== 'бренд') {
          const val = typeof attr.value === 'object' ? attr.value?.name : String(attr.value || '');
          if (val) specs[attr.name] = val;
        }
      });
    }

    // Fetch current stock from MoySklad stock report
    let stockQuantity = 0;
    try {
      const stockRes = await fetch(
        `https://api.moysklad.ru/api/remap/1.2/report/stock/all/current?filter=product=${encodeURIComponent(
          productHref
        )}`,
        { headers: getMoySkladHeaders() }
      );
      if (stockRes.ok) {
        const stockData = await stockRes.json();
        if (Array.isArray(stockData) && stockData.length > 0) {
          stockQuantity = Math.max(0, Math.floor(stockData[0].stock || 0));
        }
      }
    } catch (stockErr) {
      console.warn(`[Sync Webhook] Stock fetch error for ${productId}:`, stockErr);
    }

    const inStock = stockQuantity > 0;

    // UPSERT directly into Neon Postgres
    await sql`
      INSERT INTO my_sklad_products (
        id, title, price, stock_quantity, in_stock, brand, category,
        original_oem, clean_oem_number, image, images, specs, description, updated_at
      ) VALUES (
        ${productId},
        ${p.name},
        ${price},
        ${stockQuantity},
        ${inStock},
        ${brandInfo.brand},
        'Автозапчасти',
        ${rawOem},
        ${cleanOem},
        ${image},
        ${JSON.stringify(images)}::jsonb,
        ${JSON.stringify(specs)}::jsonb,
        ${p.description || ''},
        NOW()
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        price = EXCLUDED.price,
        stock_quantity = EXCLUDED.stock_quantity,
        in_stock = EXCLUDED.in_stock,
        brand = EXCLUDED.brand,
        category = EXCLUDED.category,
        original_oem = EXCLUDED.original_oem,
        clean_oem_number = EXCLUDED.clean_oem_number,
        image = EXCLUDED.image,
        images = EXCLUDED.images,
        specs = EXCLUDED.specs,
        description = EXCLUDED.description,
        updated_at = NOW();
    `;

    console.log(
      `[MoySklad Webhook SUCCESS] Synced product ${productId} ("${p.name}"): Price: ${price} ₸, Stock: ${stockQuantity}, Images: ${images.length}`
    );
  } catch (err) {
    console.error(`[MoySklad Webhook] Error syncing product from ${productHref}:`, err);
  }
}

/**
 * Syncs stock changes triggered by warehouse documents (sales, arrivals, write-offs)
 */
async function syncDocumentPositionsStock(docPositionsHref: string, sql: any) {
  try {
    const res = await fetch(`${docPositionsHref}?expand=assortment`, {
      headers: getMoySkladHeaders(),
    });

    if (!res.ok) return;

    const data = await res.json();
    const rows = data.rows || [];

    for (const pos of rows) {
      const productHref = pos.assortment?.meta?.href;
      if (productHref && pos.assortment?.meta?.type === 'product') {
        await syncProductFromMoySklad(productHref, sql);
      }
    }
  } catch (err) {
    console.error(`[MoySklad Webhook] Error processing document positions:`, err);
  }
}

export async function POST(request: Request) {
  try {
    const rawBody = await request.text();
    console.log('[MoySklad Webhook received]:', rawBody.slice(0, 500));

    let payload: any = {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      console.warn('[MoySklad Webhook] Non-JSON payload received');
      return NextResponse.json({ status: 'ok' });
    }

    const events = payload.events;
    if (!Array.isArray(events) || events.length === 0) {
      return NextResponse.json({ status: 'ok', message: 'No events' });
    }

    const sql = client;
    const isDbReady = isDbConfigured() && Boolean(sql);
    const results: any[] = [];

    for (const event of events) {
      const entityType = event.meta?.type;
      const action = event.action;
      const href = event.meta?.href;

      // Strict security: ensure href points strictly to official MoySklad entity API
      // to completely prevent any SSRF or MoySklad token leakage to untrusted hosts
      if (!href || typeof href !== 'string' || !href.startsWith('https://api.moysklad.ru/api/remap/1.2/entity/')) {
        console.warn('[MoySklad Webhook] Rejected untrusted or invalid href:', href);
        continue;
      }

      // 1. Order Status Updates & Cancellations
      if (entityType === 'customerorder' && action === 'UPDATE' && href) {
        try {
          const orderRes = await fetch(`${href}?expand=state,attributes`, {
            headers: getMoySkladHeaders(),
          });

          if (!orderRes.ok) {
            console.warn(`[MoySklad Webhook] Failed to fetch customerorder ${href}: ${orderRes.status}`);
            continue;
          }

          const msOrder = await orderRes.json();
          const stateName = msOrder.state?.name || '';
          const stateType = msOrder.state?.stateType || '';
          const isCancelled =
            stateName.toLowerCase().includes('отменен') ||
            stateName.toLowerCase().includes('возврат') ||
            stateType === 'Unsuccessful';

          console.log(`[MoySklad Webhook] Order "${msOrder.name}", State: "${stateName}", Cancelled: ${isCancelled}`);

          if (isCancelled && msOrder.name) {
            let reason = '';
            if (Array.isArray(msOrder.attributes)) {
              const reasonAttr = msOrder.attributes.find(
                (a: any) =>
                  a.name?.toLowerCase().includes('причина') || a.name?.toLowerCase().includes('отмен')
              );
              if (reasonAttr && reasonAttr.value) {
                reason =
                  typeof reasonAttr.value === 'object' ? reasonAttr.value.name : String(reasonAttr.value);
              }
            }

            if (!reason && msOrder.description) {
              const match = msOrder.description.match(/(?:причина(?:\s+отмены)?[:\-]\s*)([^\r\n]+)/i);
              if (match) reason = match[1].trim();
            }

            if (!reason) reason = 'Заказ отменен администратором в МойСклад.';

            const cancelResult = await cancelAndRefundOrder({
              orderId: msOrder.name,
              reason,
              cancelledBy: 'admin',
            });
            results.push(cancelResult);
          }
        } catch (eventErr) {
          console.error('[MoySklad Webhook] Error processing order event:', eventErr);
        }
      }

      // 2. Real-time Product Changes (Title, Price, Photos, Description, Attributes)
      else if (entityType === 'product' && href && isDbReady && sql) {
        if (action === 'DELETE') {
          const parts = href.split('/');
          const productId = parts[parts.length - 1];
          if (productId) {
            await sql`DELETE FROM my_sklad_products WHERE id = ${productId};`;
            console.log(`[MoySklad Webhook] Deleted product ${productId} from Neon`);
            results.push({ action: 'deleted', id: productId });
          }
        } else if (action === 'CREATE' || action === 'UPDATE') {
          await syncProductFromMoySklad(href, sql);
          results.push({ action: 'upserted', href });
        }
      }

      // 3. Real-time Stock Changes from Warehouse Documents (Dispatches, Sales, Arrivals, Intake)
      else if (
        (entityType === 'demand' ||
          entityType === 'retaildemand' ||
          entityType === 'enter' ||
          entityType === 'supply' ||
          entityType === 'loss') &&
        href &&
        action === 'CREATE' &&
        isDbReady &&
        sql
      ) {
        console.log(`[MoySklad Webhook] Processing stock document ${entityType}...`);
        await syncDocumentPositionsStock(`${href}/positions`, sql);
        results.push({ action: 'stock_synced', document: entityType });
      }
    }

    return NextResponse.json({ status: 'ok', processed: results.length, results });
  } catch (error: any) {
    console.error('[MoySklad Webhook Fatal Error]:', error);
    return NextResponse.json({ status: 'error', message: error?.message }, { status: 200 });
  }
}

export async function GET() {
  return NextResponse.json({ status: 'active', service: 'MoySklad Real-time Webhook Ingestion Engine' });
}
