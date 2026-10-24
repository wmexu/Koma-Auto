import postgres from 'postgres';
import crypto from 'crypto';

const TOKEN = process.env.MOYSKLAD_TOKEN;
const API_URL = process.env.MOYSKLAD_API_URL || 'https://api.moysklad.ru/api/remap/1.2';
const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL || !TOKEN) {
  console.error('DATABASE_URL and MOYSKLAD_TOKEN must be defined.');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 10, idle_timeout: 20 });

// Helper to compute a pretty round old price ~20-25% higher than price
function calculatePrettyOldPrice(price) {
  if (!price || price < 1000) return null;
  const rawTarget = price * 1.25;

  if (price < 2000) {
    return Math.ceil(rawTarget / 100) * 100;
  } else if (price < 10000) {
    return Math.ceil(rawTarget / 500) * 500;
  } else {
    // 11000 * 1.25 = 13750 -> 14000
    return Math.ceil(rawTarget / 1000) * 1000;
  }
}

// Deterministic check for 5% of products
function isSaleItem(id) {
  const hash = crypto.createHash('md5').update(id).digest('hex');
  const num = parseInt(hash.slice(0, 4), 16);
  return (num % 100) < 5; // exactly 5%
}

async function run() {
  console.log('=== SYNCING MOYSKLAD FOLDERS & APPLYING 5% ROUND SALE PRICES ===\n');

  // 1. Fetch total products
  const countRes = await fetch(`${API_URL}/entity/product?limit=1`, {
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/json;charset=utf-8' },
  });
  const countData = await countRes.json();
  const total = countData.meta?.size || 18102;
  console.log(`Total products to sync: ${total}`);

  const batchSize = 1000;
  let offset = 0;
  let totalUpdated = 0;
  let totalSales = 0;
  const folderStats = {};

  while (offset < total) {
    console.log(`Fetching batch offset ${offset}/${total}...`);
    let res;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        res = await fetch(`${API_URL}/entity/product?limit=${batchSize}&offset=${offset}&expand=productFolder`, {
          headers: {
            Authorization: `Bearer ${TOKEN}`,
            Accept: 'application/json;charset=utf-8',
            'Accept-Encoding': 'gzip',
          },
        });
        if (res.ok) break;
        console.warn(`[Retry] Attempt ${attempt} failed with status ${res.status}. Waiting 2s...`);
        await new Promise(r => setTimeout(r, 2000));
      } catch (err) {
        console.warn(`[Retry] Network error on attempt ${attempt}:`, err.message);
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    if (!res || !res.ok) {
      console.error(`Failed to fetch batch at offset ${offset}. Skipping.`);
      offset += batchSize;
      continue;
    }

    const data = await res.json();
    const rows = data.rows || [];
    if (rows.length === 0) break;

    // Build update statements
    const updates = [];
    for (const p of rows) {
      let folderName = p.productFolder?.name || 'Автозапчасти';
      if (folderName === 'Без группы' || !folderName.trim()) {
        folderName = 'Автозапчасти';
      }
      folderStats[folderName] = (folderStats[folderName] || 0) + 1;

      const price = p.salePrices?.[0]?.value ? p.salePrices[0].value / 100 : 0;
      let oldPrice = null;
      if (isSaleItem(p.id) && price >= 1000) {
        oldPrice = calculatePrettyOldPrice(price);
        totalSales++;
      }

      updates.push({
        id: p.id,
        category: folderName,
        old_price: oldPrice,
      });
    }

    // Bulk update in Neon via sql batch/values
    if (updates.length > 0) {
      // Chunk updates into groups of 250 for fast Postgres execution
      for (let i = 0; i < updates.length; i += 250) {
        const chunk = updates.slice(i, i + 250);
        await sql`
          UPDATE my_sklad_products AS p
          SET 
            category = u.category,
            old_price = u.old_price::numeric,
            updated_at = NOW()
          FROM (VALUES ${sql(chunk.map(c => [c.id, c.category, c.old_price]))}) AS u(id, category, old_price)
          WHERE p.id = u.id;
        `;
      }
    }

    totalUpdated += rows.length;
    offset += batchSize;
    console.log(`Processed ${totalUpdated}/${total} products...`);
  }

  console.log('\n=== SYNC COMPLETED ===');
  console.log(`Total products updated: ${totalUpdated}`);
  console.log(`Total 5% sale products generated: ${totalSales}`);
  
  // Verify DB state
  const dbCats = await sql`
    SELECT category, count(*)::int as cnt 
    FROM my_sklad_products 
    GROUP BY category 
    ORDER BY cnt DESC 
    LIMIT 15;
  `;
  console.log('\nTop 15 Categories in Neon DB:', dbCats);

  const sampleSales = await sql`
    SELECT id, title, price, old_price, category 
    FROM my_sklad_products 
    WHERE old_price IS NOT NULL 
    LIMIT 5;
  `;
  console.log('\nSample 5% Sale Products in DB:', sampleSales);

  process.exit(0);
}

run().catch(err => {
  console.error('Fatal error during sync:', err);
  process.exit(1);
});
