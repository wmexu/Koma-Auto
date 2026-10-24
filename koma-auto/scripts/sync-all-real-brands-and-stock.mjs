import fs from 'fs';
import postgres from 'postgres';
import { normalizeBrand } from '../lib/brand-utils.ts';

const env = fs.readFileSync('.env.local', 'utf8');
const getVar = (name) => {
  const m = env.match(new RegExp(`${name}=["']?([^"'\\r\\n]+)`));
  return m ? m[1].trim() : '';
};

const token = getVar('MOYSKLAD_TOKEN');
const apiUrl = getVar('MOYSKLAD_API_URL') || 'https://api.moysklad.ru/api/remap/1.2';
const podvalStore = 'https://api.moysklad.ru/api/remap/1.2/entity/store/4240a87a-4ea5-11f1-0a80-1b5c0008497a';
const dbUrl = getVar('DATABASE_URL');
const sql = postgres(dbUrl, { max: 10, idle_timeout: 20 });

const BATCH_SIZE = 100;

async function fetchBatch(offset) {
  const url = `${apiUrl}/entity/assortment?limit=${BATCH_SIZE}&offset=${offset}&expand=supplier,productFolder&stockStore=${encodeURIComponent(podvalStore)}`;
  let retries = 3;
  while (retries > 0) {
    try {
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Accept': 'application/json;charset=utf-8'
        }
      });
      if (res.status === 429 || res.status >= 500) {
        console.warn(`[Offset ${offset}] Status ${res.status}. Waiting 2s...`);
        await new Promise(r => setTimeout(r, 2000));
        retries--;
        continue;
      }
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }
      return await res.json();
    } catch (e) {
      console.warn(`[Offset ${offset}] Error: ${e.message}. Retrying...`);
      retries--;
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return null;
}

async function main() {
  console.log('=== STARTING FULL SYNC OF REAL BRANDS & STOCK FROM MOYSKLAD TO NEON ===');
  const t0 = Date.now();

  // Get total count
  const initialData = await fetchBatch(0);
  if (!initialData) {
    console.error('Failed to get initial batch');
    process.exit(1);
  }
  const total = initialData.meta?.size || 18106;
  console.log(`Total assortment products to sync: ${total}`);

  let processed = 0;
  let offset = 0;

  while (offset < total) {
    const data = offset === 0 ? initialData : await fetchBatch(offset);
    if (!data || !data.rows || data.rows.length === 0) {
      console.log(`No more rows at offset ${offset}. Finished.`);
      break;
    }

    const rows = data.rows;
    const updateItems = rows.map((r) => {
      const brandInfo = normalizeBrand(r.supplier?.name, r.code);
      const stock = Math.max(0, Number(r.stock) || 0);
      const inStock = stock > 0;
      let cat = r.productFolder?.name || null;
      if (cat === 'Без группы' || (cat && !cat.trim())) {
        cat = null;
      }
      return [r.id, brandInfo.brand, stock, inStock, cat];
    });

    try {
      await sql`
        UPDATE my_sklad_products AS m
        SET 
          brand = u.brand,
          stock_quantity = u.stock_quantity::int,
          in_stock = u.in_stock::boolean,
          category = COALESCE(u.category, m.category)
        FROM (VALUES ${sql(updateItems)}) AS u(id, brand, stock_quantity, in_stock, category)
        WHERE m.id = u.id;
      `;
    } catch (dbErr) {
      console.error(`DB error at offset ${offset}:`, dbErr.message);
    }

    processed += rows.length;
    offset += rows.length;

    if (processed % 1000 < BATCH_SIZE || offset >= total) {
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      const pct = ((processed / total) * 100).toFixed(1);
      console.log(`Progress: ${processed}/${total} (${pct}%) in ${elapsed}s...`);
    }

    // Small delay between requests to keep MoySklad happy
    await new Promise(r => setTimeout(r, 120));
  }

  const elapsedTotal = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`=== SYNC COMPLETE in ${elapsedTotal}s! ===`);

  // Verify DB stats after sync
  const brandBreakdown = await sql`
    SELECT brand, count(*)::int as count 
    FROM my_sklad_products 
    GROUP BY brand 
    ORDER BY count DESC 
    LIMIT 20;
  `;
  console.log('Top 20 brands in Neon after sync:', brandBreakdown);

  const stockStats = await sql`
    SELECT 
      count(*)::int as total,
      count(*) FILTER (WHERE in_stock = true)::int as in_stock,
      count(*) FILTER (WHERE in_stock = false)::int as out_of_stock,
      count(*) FILTER (WHERE stock_quantity = 5)::int as hardcoded_5_count,
      avg(stock_quantity)::numeric(10,2) as avg_stock,
      max(stock_quantity)::int as max_stock
    FROM my_sklad_products;
  `;
  console.log('Stock distribution after sync:', stockStats[0]);

  await sql.end();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
