import postgres from 'postgres';

const token = process.env.MOYSKLAD_TOKEN;
const apiUrl = process.env.MOYSKLAD_API_URL || 'https://api.moysklad.ru/api/remap/1.2';
const dbUrl = process.env.DATABASE_URL;

if (!token || !dbUrl) {
  console.error('Missing MOYSKLAD_TOKEN or DATABASE_URL');
  process.exit(1);
}

const sql = postgres(dbUrl, { max: 10, idle_timeout: 20 });

export const STORES = [
  { id: '4240a87a-4ea5-11f1-0a80-1b5c0008497a', name: 'Car City 1 ярус Подвал' },
  { id: '1fa24dca-7a9a-11f1-0a80-136c0004b13a', name: 'Car City 4 ярус Shukur' },
  { id: '80a4ab92-914b-11f1-0a80-00580016cddc', name: 'Car City 4 ярус Бохо' },
  { id: 'eabd6cc4-896e-11f1-0a80-06a40027eb6a', name: 'Car City 4 ярус Иззат' },
  { id: '790b52f2-4aa7-11f1-0a80-1ac70019f4b1', name: 'Car City 4 ярус Радиаторы' },
  { id: 'ff2b1657-4ea4-11f1-0a80-134100085ef2', name: 'Основной Таусогар' },
  { id: '1c1ad4e3-4ea5-11f1-0a80-0df00008db2b', name: 'Склад Айтей' },
];

function extractId(href) {
  if (!href) return null;
  const clean = href.split('?')[0];
  const parts = clean.split('/');
  return parts[parts.length - 1];
}

async function fetchStoreStock(storeId) {
  let offset = 0;
  const limit = 1000;
  const map = new Map();
  let total = Infinity;

  const storeHref = `https://api.moysklad.ru/api/remap/1.2/entity/store/${storeId}`;

  while (offset < total) {
    const url = `${apiUrl}/report/stock/all?filter=store=${encodeURIComponent(storeHref)}&limit=${limit}&offset=${offset}`;
    let retries = 3;
    let data = null;

    while (retries > 0) {
      try {
        const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
        if (res.status === 429) {
          console.warn(`[429] Waiting 2.5s for store ${storeId}...`);
          await new Promise((r) => setTimeout(r, 2500));
          retries--;
          continue;
        }
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        data = await res.json();
        break;
      } catch (e) {
        console.warn(`Retry fetch for store ${storeId} at offset ${offset}: ${e.message}`);
        retries--;
        await new Promise((r) => setTimeout(r, 1500));
      }
    }

    if (!data) break;
    total = data.meta?.size || 0;
    const rows = data.rows || [];
    for (const r of rows) {
      const pId = extractId(r.meta?.href);
      if (pId) {
        const stock = Math.max(0, Math.floor(Number(r.stock) || 0));
        map.set(pId, stock);
      }
    }
    offset += rows.length;
    if (rows.length === 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }

  return map;
}

async function main() {
  console.log('=== STARTING MULTI-WAREHOUSE STOCK SYNC ===');
  const t0 = Date.now();

  const storeMaps = {};
  for (const s of STORES) {
    console.log(`Fetching stock for store: "${s.name}" (${s.id})...`);
    storeMaps[s.id] = await fetchStoreStock(s.id);
    console.log(` -> Found ${storeMaps[s.id].size} in-stock products for "${s.name}"`);
  }

  console.log('\nFetching all existing product IDs from Neon Postgres...');
  const dbRows = await sql`SELECT id FROM my_sklad_products;`;
  console.log(`Total products in database: ${dbRows.length}`);

  const podvalId = '4240a87a-4ea5-11f1-0a80-1b5c0008497a';
  const BATCH_SIZE = 500;
  let updatedCount = 0;

  for (let i = 0; i < dbRows.length; i += BATCH_SIZE) {
    const batch = dbRows.slice(i, i + BATCH_SIZE);

    const values = batch.map((row) => {
      const pid = row.id;
      const stocksObj = {};
      let total = 0;

      for (const s of STORES) {
        const qty = storeMaps[s.id].get(pid) || 0;
        if (qty > 0) {
          stocksObj[s.id] = qty;
        }
        total += qty;
      }

      const podvalStock = stocksObj[podvalId] || 0;

      return {
        id: pid,
        stocks_by_store: JSON.stringify(stocksObj),
        stock_podval: podvalStock,
        in_stock_podval: podvalStock > 0,
        stock_total: total,
        in_stock_total: total > 0,
      };
    });

    await sql`
      UPDATE my_sklad_products AS p
      SET
        stocks_by_store = v.stocks_by_store::jsonb,
        stock_podval = v.stock_podval::int,
        in_stock_podval = v.in_stock_podval::boolean,
        stock_total = v.stock_total::int,
        in_stock_total = v.in_stock_total::boolean,
        updated_at = NOW()
      FROM (
        VALUES ${sql(
          values.map((v) => [
            v.id,
            v.stocks_by_store,
            v.stock_podval,
            v.in_stock_podval,
            v.stock_total,
            v.in_stock_total,
          ])
        )}
      ) AS v(id, stocks_by_store, stock_podval, in_stock_podval, stock_total, in_stock_total)
      WHERE p.id = v.id;
    `;

    updatedCount += batch.length;
    if (updatedCount % 2500 === 0 || updatedCount === dbRows.length) {
      console.log(`Updated ${updatedCount} / ${dbRows.length} products...`);
    }
  }

  // Update active stock_quantity based on current system_settings
  console.log('\nRecalculating active stock based on system_settings...');
  const settingRow = await sql`SELECT value FROM system_settings WHERE key = 'active_warehouse' LIMIT 1;`;
  let activeWarehouses = [podvalId]; // default: Podval
  if (settingRow && settingRow.length > 0) {
    try {
      const raw = settingRow[0].value;
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (Array.isArray(parsed?.store_ids) && parsed.store_ids.length > 0) {
        activeWarehouses = parsed.store_ids;
      } else if (parsed?.id === 'all_warehouses' || parsed?.name === 'Все склады') {
        activeWarehouses = STORES.map((s) => s.id);
      } else if (parsed?.id === 'car_city_podval' || parsed?.name === 'Car City 1 ярус Подвал') {
        activeWarehouses = [podvalId];
      }
    } catch {}
  }

  console.log(`Active warehouse IDs (${activeWarehouses.length}):`, activeWarehouses);

  // Compute stock_quantity as sum of stocks across activeWarehouses
  // We can construct the jsonb sum expression
  const sumExpr = activeWarehouses
    .map((sid) => `COALESCE((stocks_by_store->>'${sid}')::int, 0)`)
    .join(' + ');

  await sql.unsafe(`
    UPDATE my_sklad_products
    SET
      stock_quantity = (${sumExpr}),
      in_stock = (${sumExpr}) > 0,
      updated_at = NOW();
  `);

  console.log(`Stock recalculation complete in ${((Date.now() - t0) / 1000).toFixed(1)}s!`);
  await sql.end();
}

main().catch((err) => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
