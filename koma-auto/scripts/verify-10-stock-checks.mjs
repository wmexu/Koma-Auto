import fs from 'fs';
import postgres from 'postgres';

if (fs.existsSync('.env.local')) {
  const content = fs.readFileSync('.env.local', 'utf-8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx > 0) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

const sql = postgres(process.env.DATABASE_URL, { max: 5 });

const MOYSKLAD_API_URL = process.env.MOYSKLAD_API_URL || 'https://api.moysklad.ru/api/remap/1.2';
const authHeader = process.env.MOYSKLAD_TOKEN
  ? `Bearer ${process.env.MOYSKLAD_TOKEN}`
  : `Basic ${Buffer.from(
      `${process.env.MOYSKLAD_LOGIN || 'admin@koma-auto1'}:${process.env.MOYSKLAD_PASSWORD || ''}`
    ).toString('base64')}`;

const STORES = [
  { id: '4240a87a-4ea5-11f1-0a80-1b5c0008497a', name: 'Car City 1 ярус Подвал' },
  { id: '1fa24dca-7a9a-11f1-0a80-136c0004b13a', name: 'Car City 4 ярус Shukur' },
  { id: '80a4ab92-914b-11f1-0a80-00580016cddc', name: 'Car City 4 ярус Бохо' },
  { id: 'eabd6cc4-896e-11f1-0a80-06a40027eb6a', name: 'Car City 4 ярус Иззат' },
  { id: '790b52f2-4aa7-11f1-0a80-1ac70019f4b1', name: 'Car City 4 ярус Радиаторы' },
  { id: 'ff2b1657-4ea4-11f1-0a80-134100085ef2', name: 'Основной Таусогар' },
  { id: '1c1ad4e3-4ea5-11f1-0a80-0df00008db2b', name: 'Склад Айтей' },
];

async function fetchMoySkladStoreStock(productId) {
  const url = `${MOYSKLAD_API_URL}/report/stock/bystore?filter=product=https://api.moysklad.ru/api/remap/1.2/entity/product/${productId}`;
  const res = await fetch(url, {
    headers: {
      Authorization: authHeader,
      'Accept-Encoding': 'gzip',
    },
  });
  if (!res.ok) {
    throw new Error(`MoySklad API error ${res.status}: ${await res.text()}`);
  }
  const data = await res.json();
  const msStocks = {};
  const row = data.rows?.[0];
  if (row && Array.isArray(row.stockByStore)) {
    for (const s of row.stockByStore) {
      const storeHref = s.meta?.href || '';
      const storeId = storeHref.split('/').pop()?.split('?')[0];
      if (storeId) {
        msStocks[storeId] = Math.max(0, Math.floor(s.stock || 0));
      }
    }
  }
  return msStocks;
}

async function run() {
  console.log('=== RUNNING 10 REAL-TIME WAREHOUSE STOCK CHECKS ===\n');

  // Query 10 diverse products from database:
  // 1-3: Items with stock in Podval
  // 4-6: Items with stock across multiple stores
  // 7-8: Items with stock in non-Podval stores (e.g. Tausogar or Boho)
  // 9: Item with stock = 1 (to check display stock +5 rule)
  // 10: Item with stock = 0
  const rows = await sql`
    (SELECT id, title, clean_oem_number, original_oem, stock_quantity, stock_podval, stock_total, stocks_by_store 
     FROM my_sklad_products WHERE stock_podval > 0 ORDER BY id LIMIT 3)
    UNION ALL
    (SELECT id, title, clean_oem_number, original_oem, stock_quantity, stock_podval, stock_total, stocks_by_store 
     FROM my_sklad_products WHERE stock_total > stock_podval AND stock_podval > 0 ORDER BY id LIMIT 3)
    UNION ALL
    (SELECT id, title, clean_oem_number, original_oem, stock_quantity, stock_podval, stock_total, stocks_by_store 
     FROM my_sklad_products WHERE stock_podval = 0 AND stock_total > 0 ORDER BY id LIMIT 2)
    UNION ALL
    (SELECT id, title, clean_oem_number, original_oem, stock_quantity, stock_podval, stock_total, stocks_by_store 
     FROM my_sklad_products WHERE stock_quantity = 1 ORDER BY id LIMIT 1)
    UNION ALL
    (SELECT id, title, clean_oem_number, original_oem, stock_quantity, stock_podval, stock_total, stocks_by_store 
     FROM my_sklad_products WHERE stock_total = 0 ORDER BY id LIMIT 1)
    LIMIT 10;
  `;

  console.log(`Selected ${rows.length} test products from DB.\n`);

  let passed = 0;
  let failed = 0;

  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    console.log(`--------------------------------------------------------------------------------`);
    console.log(`[CHECK ${i + 1}/10] Product: "${r.title.slice(0, 45)}..." (ID: ${r.id})`);
    console.log(`  OEM: ${r.original_oem || r.clean_oem_number || 'N/A'}`);

    // Fetch directly from MoySklad API
    const msStocks = await fetchMoySkladStoreStock(r.id);
    const dbStocks = typeof r.stocks_by_store === 'string' ? JSON.parse(r.stocks_by_store) : (r.stocks_by_store || {});

    let msTotal = 0;
    let dbTotal = 0;
    let msPodval = msStocks['4240a87a-4ea5-11f1-0a80-1b5c0008497a'] || 0;
    let dbPodval = dbStocks['4240a87a-4ea5-11f1-0a80-1b5c0008497a'] || 0;

    let storeMismatches = [];

    for (const store of STORES) {
      const msVal = msStocks[store.id] || 0;
      const dbVal = dbStocks[store.id] || 0;
      msTotal += msVal;
      dbTotal += dbVal;

      if (msVal !== dbVal) {
        storeMismatches.push(`${store.name}: MS=${msVal} vs DB=${dbVal}`);
      }
    }

    const podvalMatches = msPodval === Number(r.stock_podval);
    const totalMatches = msTotal === Number(r.stock_total);
    const storesMatch = storeMismatches.length === 0;

    console.log(`  MoySklad Podval: ${msPodval} | DB stock_podval: ${r.stock_podval} [${podvalMatches ? '✓ OK' : '✗ MISMATCH'}]`);
    console.log(`  MoySklad Total:  ${msTotal} | DB stock_total:  ${r.stock_total} [${totalMatches ? '✓ OK' : '✗ MISMATCH'}]`);
    console.log(`  Active Stock in DB: ${r.stock_quantity}`);

    if (storesMatch && podvalMatches && totalMatches) {
      console.log(`  Status: ✓ PASSED - Exact real-time match across all 7 warehouses!`);
      passed++;
    } else {
      console.error(`  Status: ✗ FAILED`);
      if (storeMismatches.length > 0) {
        console.error(`  Store mismatches:`, storeMismatches.join(', '));
      }
      failed++;
    }

    // Small delay to be polite to MoySklad API rate limits
    await new Promise((res) => setTimeout(res, 200));
  }

  console.log(`================================================================================`);
  console.log(`VERIFICATION SUMMARY: ${passed}/10 Passed, ${failed}/10 Failed.`);
  console.log(`================================================================================`);

  await sql.end();
  process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
  console.error('Fatal error during verification:', err);
  process.exit(1);
});
