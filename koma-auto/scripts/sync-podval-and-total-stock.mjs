import fs from 'fs';
import postgres from 'postgres';

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

function extractId(href) {
  if (!href) return null;
  const clean = href.split('?')[0];
  const parts = clean.split('/');
  return parts[parts.length - 1];
}

async function fetchAllPages(endpointUrl) {
  let offset = 0;
  const limit = 1000;
  const allRows = [];
  let total = Infinity;

  while (offset < total) {
    const separator = endpointUrl.includes('?') ? '&' : '?';
    const url = `${apiUrl}${endpointUrl}${separator}limit=${limit}&offset=${offset}`;
    
    let retries = 3;
    let data = null;
    while (retries > 0) {
      try {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (res.status === 429) {
          console.warn(`[429 Rate Limit] Waiting 2.5s before retry...`);
          await new Promise(r => setTimeout(r, 2500));
          retries--;
          continue;
        }
        if (!res.ok) {
          throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }
        data = await res.json();
        break;
      } catch (e) {
        console.warn(`[Fetch error at offset ${offset}]: ${e.message}. Retrying...`);
        retries--;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!data) {
      console.error(`Failed to fetch page at offset ${offset}`);
      break;
    }

    total = data.meta?.size || 0;
    const rows = data.rows || [];
    allRows.push(...rows);
    offset += rows.length;
    console.log(`Fetched ${allRows.length} / ${total} rows...`);

    if (rows.length === 0) break;
    // Small delay between requests to be safe
    await new Promise(r => setTimeout(r, 300));
  }

  return allRows;
}

async function main() {
  console.log('=== STARTING SYNC OF PODVAL AND TOTAL STOCK ===');
  const t0 = Date.now();

  // 1. Fetch Podval Stock
  console.log('\n1. Fetching Podval warehouse stock (/report/stock/all?filter=store=podvalStore)...');
  const podvalRows = await fetchAllPages(`/report/stock/all?filter=store=${encodeURIComponent(podvalStore)}`);
  console.log(`Total rows fetched for Podval: ${podvalRows.length}`);

  const podvalStockMap = new Map();
  for (const r of podvalRows) {
    const id = extractId(r.meta?.href);
    if (id) {
      const stock = Math.max(0, Math.floor(Number(r.stock) || 0));
      podvalStockMap.set(id, stock);
    }
  }

  // 2. Fetch Total Stock Across All Warehouses
  console.log('\n2. Fetching Total stock across all warehouses (/report/stock/all)...');
  const totalRows = await fetchAllPages(`/report/stock/all`);
  console.log(`Total rows fetched across all stores: ${totalRows.length}`);

  const totalStockMap = new Map();
  for (const r of totalRows) {
    const id = extractId(r.meta?.href);
    if (id) {
      const stock = Math.max(0, Math.floor(Number(r.stock) || 0));
      totalStockMap.set(id, stock);
    }
  }

  // 3. Update PostgreSQL Neon DB
  console.log('\n3. Resetting default stock values in PostgreSQL...');
  await sql`
    UPDATE my_sklad_products
    SET 
      stock_podval = 0,
      in_stock_podval = false,
      stock_total = 0,
      in_stock_total = false,
      stock_quantity = 0,
      in_stock = false;
  `;

  // Update in chunks of 500
  console.log('\n4. Applying real Podval & Total stock in batches to Neon DB...');
  const allProductIds = Array.from(new Set([...podvalStockMap.keys(), ...totalStockMap.keys()]));
  console.log(`Unique products with stock records: ${allProductIds.length}`);

  const CHUNK_SIZE = 500;
  for (let i = 0; i < allProductIds.length; i += CHUNK_SIZE) {
    const chunkIds = allProductIds.slice(i, i + CHUNK_SIZE);
    const updateValues = chunkIds.map(id => {
      const pStock = podvalStockMap.get(id) || 0;
      const tStock = totalStockMap.get(id) || 0;
      const pInStock = pStock > 0;
      const tInStock = tStock > 0;
      // Active stock is set to Podval!
      return [id, pStock, pInStock, tStock, tInStock, pStock, pInStock];
    });

    await sql`
      UPDATE my_sklad_products AS m
      SET 
        stock_podval = u.stock_podval::int,
        in_stock_podval = u.in_stock_podval::boolean,
        stock_total = u.stock_total::int,
        in_stock_total = u.in_stock_total::boolean,
        stock_quantity = u.stock_quantity::int,
        in_stock = u.in_stock::boolean,
        updated_at = NOW()
      FROM (VALUES ${sql(updateValues)}) AS u(id, stock_podval, in_stock_podval, stock_total, in_stock_total, stock_quantity, in_stock)
      WHERE m.id = u.id;
    `;

    console.log(`Updated ${Math.min(i + CHUNK_SIZE, allProductIds.length)} / ${allProductIds.length} products in DB...`);
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n=== SYNC FINISHED in ${elapsed}s! ===`);

  // Verify DB distribution
  const stats = await sql`
    SELECT 
      count(*)::int as total_products,
      count(*) FILTER (WHERE in_stock_podval = true)::int as podval_in_stock,
      count(*) FILTER (WHERE in_stock_total = true)::int as total_in_stock,
      count(*) FILTER (WHERE in_stock = true)::int as active_in_stock,
      sum(stock_podval)::int as total_podval_items,
      sum(stock_total)::int as total_all_stores_items
    FROM my_sklad_products;
  `;
  console.log('Final DB Stats:', stats[0]);

  // Check test product 39f38c79-8a1e-11f1-0a80-1d0b00094d62
  const checkSample = await sql`
    SELECT id, title, stock_podval, in_stock_podval, stock_total, in_stock_total, stock_quantity, in_stock
    FROM my_sklad_products
    WHERE id = '39f38c79-8a1e-11f1-0a80-1d0b00094d62';
  `;
  console.log('Sample product check (39f38c79):', checkSample[0]);

  await sql.end();
}

main().catch(err => {
  console.error('Fatal sync error:', err);
  process.exit(1);
});
