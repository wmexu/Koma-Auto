import dns from 'node:dns';
if (typeof dns.setDefaultResultOrder === 'function') {
  try { dns.setDefaultResultOrder('ipv4first'); } catch {}
}
import fs from 'fs';
import path from 'path';
import postgres from 'postgres';

// 1. Read .env.local
const envPath = path.resolve('.env.local');
const env = {};
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, 'utf8')
    .split('\n')
    .forEach((line) => {
      const trimmed = line.trim();
      if (trimmed && !trimmed.startsWith('#') && trimmed.includes('=')) {
        const idx = trimmed.indexOf('=');
        let val = trimmed.slice(idx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        env[trimmed.slice(0, idx).trim()] = val;
      }
    });
}

const DATABASE_URL = env.DATABASE_URL || process.env.DATABASE_URL;
const MOYSKLAD_TOKEN = env.MOYSKLAD_TOKEN || process.env.MOYSKLAD_TOKEN;
const API_URL = env.MOYSKLAD_API_URL || 'https://api.moysklad.ru/api/remap/1.2';
const STORE_HREF =
  'https://api.moysklad.ru/api/remap/1.2/entity/store/4240a87a-4ea5-11f1-0a80-1b5c0008497a'; // Car City 1 ярус Подвал

if (!DATABASE_URL) {
  console.error('\n[ERROR] DATABASE_URL is not defined in .env.local!');
  console.error('Please add DATABASE_URL="postgres://..." to .env.local and run again.\n');
  process.exit(1);
}

if (!MOYSKLAD_TOKEN) {
  console.error('\n[ERROR] MOYSKLAD_TOKEN is missing in .env.local!\n');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 10, idle_timeout: 20 });

// Helper: Extract clean OEM
function extractCleanOem(code, article, name) {
  const isInternal = (s) => /^00[0-9]{4,}$/.test(s) || /^[0-9]{1,4}$/.test(s);
  const cleanCode = (code || '').trim().replace(/[\s\-\.]/g, '');
  let cleanArt = (article || '').trim().replace(/[\s\-\.]/g, '');
  if (isInternal(cleanArt)) cleanArt = '';

  const raw = cleanCode || cleanArt;
  if (!raw) {
    if (name) {
      const m = name.match(/([0-9]{5}[0-9a-zA-Z]{5}|[1-9][0-9]{7})/i);
      if (m) return m[1].toUpperCase();
    }
    return 'NO_OEM';
  }

  const gm = raw.match(/^([1-9][0-9]{7})([a-zA-Z]*)$/);
  if (gm) return gm[1];

  const hk = raw.match(/^([0-9]{5}[0-9a-zA-Z]{5})([a-zA-Z]*)$/i);
  if (hk) return hk[1].toUpperCase();

  const sfx = raw.match(/^([0-9a-zA-Z]{4,})?(org|mob|gmq|gm|buz|uz|sq|hq|kex|kp|kap|ps|mp|car|kw|os|aydo|trt|ml|ux|cs|saul|mj|ysf|dyc|dy|ch|bs|sl|hyt|excel|w)$/i);
  if (sfx && sfx[1] && !isInternal(sfx[1])) return sfx[1].toUpperCase();

  const genSfx = raw.match(/^([0-9a-zA-Z]{4,})([a-zA-Z]{1,4})$/);
  if (genSfx && !isInternal(genSfx[1])) return genSfx[1].toUpperCase();

  return isInternal(raw) ? 'NO_OEM' : raw.toUpperCase();
}

// Helper: Extract Vehicle Compatibility
function extractCompatibility(name, code, cleanOem) {
  const text = `${name} ${code}`.toLowerCase();
  const list = [];

  const patterns = [
    { re: /акцент|accent|солярис|solaris/i, text: 'Hyundai Accent / Solaris (2010–2022)' },
    { re: /элантра|elantra/i, text: 'Hyundai Elantra (2011–2020)' },
    { re: /соната|sonata/i, text: 'Hyundai Sonata (2010–2019)' },
    { re: /туссан|тусон|tucson/i, text: 'Hyundai Tucson (2004–2021)' },
    { re: /санта[\s\-]?фе|santa[\s\-]?fe/i, text: 'Hyundai Santa Fe (2006–2018)' },
    { re: /крета|creta/i, text: 'Hyundai Creta (2016–2021)' },
    { re: /\bрио\b|rio/i, text: 'Kia Rio (2011–2022)' },
    { re: /церато|cerato|forte/i, text: 'Kia Cerato (2009–2018)' },
    { re: /оптима|optima|\bk[\s\-]?5\b/i, text: 'Kia Optima (K5) (2010–2020)' },
    { re: /спортейдж|спортаж|sportage/i, text: 'Kia Sportage (2010–2021)' },
    { re: /соренто|sorento/i, text: 'Kia Sorento (2009–2020)' },
    { re: /нексия|nexia/i, text: 'Daewoo Nexia (1995–2016)' },
    { re: /матиз|matiz/i, text: 'Daewoo Matiz (1998–2018)' },
    { re: /ланос|lanos/i, text: 'Daewoo Lanos (1997–2017)' },
    { re: /лачетти|ласетти|lacetti|джентра|gentra/i, text: 'Chevrolet Lacetti / Gentra (2003–2020)' },
    { re: /кобальт|cobalt/i, text: 'Chevrolet Cobalt (2012–2024)' },
    { re: /круз|cruze/i, text: 'Chevrolet Cruze (2009–2016)' },
    { re: /авео|aveo/i, text: 'Chevrolet Aveo (2003–2018)' },
    { re: /камри|camry/i, text: 'Toyota Camry (2006–2023)' },
    { re: /королла|corolla/i, text: 'Toyota Corolla (2007–2022)' },
    { re: /рав[\s\-]?4|rav[\s\-]?4/i, text: 'Toyota RAV4 (2006–2023)' },
    { re: /прадо|prado/i, text: 'Toyota Land Cruiser Prado (2002–2023)' },
  ];

  for (const p of patterns) {
    if (p.re.test(text)) list.push(p.text);
  }

  // OEM platform codes
  if (cleanOem.length >= 7) {
    const pCode = cleanOem.substring(5, 7);
    if (pCode === '2P') list.push('Kia Sorento (XM) / Hyundai Santa Fe (DM)');
    if (pCode === '3X') list.push('Hyundai Elantra (MD)');
    if (pCode === '1R' || pCode === '4L') list.push('Hyundai Accent / Solaris (RB)');
    if (pCode === '4X') list.push('Kia Rio (UB)');
    if (pCode === '2T') list.push('Kia Optima (TF)');
    if (pCode === 'H8') list.push('Kia Rio 4 / Solaris 2');
  }

  if (list.length === 0) {
    if (/hyundai|kia/i.test(text)) list.push('Hyundai / Kia (модели с подходящим OEM)');
    else if (/daewoo|chevrolet/i.test(text)) list.push('Chevrolet / Daewoo (модели с подходящим OEM)');
    else if (/toyota/i.test(text)) list.push('Toyota (модели с подходящим OEM)');
  }

  return Array.from(new Set(list));
}

async function run() {
  console.log('=== KOMA AUTO: FULL CATALOG INGESTION (18,000+ PRODUCTS) ===\n');

  // 1. Initialize Tables
  console.log('1. Initializing PostgreSQL schema & indexes...');
  await sql`
    CREATE TABLE IF NOT EXISTS my_sklad_products (
      id VARCHAR(255) PRIMARY KEY,
      title TEXT NOT NULL,
      price NUMERIC NOT NULL,
      old_price NUMERIC,
      stock_quantity INTEGER NOT NULL DEFAULT 0,
      in_stock BOOLEAN NOT NULL DEFAULT false,
      brand VARCHAR(100),
      category VARCHAR(100),
      original_oem VARCHAR(255),
      clean_oem_number VARCHAR(255) NOT NULL,
      image TEXT,
      images JSONB DEFAULT '[]'::jsonb,
      specs JSONB DEFAULT '{}'::jsonb,
      compatibility JSONB DEFAULT '[]'::jsonb,
      description TEXT,
      updated_at TIMESTAMP DEFAULT NOW()
    );
  `;

  await sql`CREATE INDEX IF NOT EXISTS idx_ms_clean_oem ON my_sklad_products(clean_oem_number);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ms_brand ON my_sklad_products(brand);`;
  await sql`CREATE INDEX IF NOT EXISTS idx_ms_in_stock ON my_sklad_products(in_stock);`;

  console.log('Schema ready.\n');

  // 2. Fetch Total Count from MoySklad
  const initialRes = await fetch(`${API_URL}/entity/product?limit=1`, {
    headers: {
      Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
      'Accept-Encoding': 'gzip',
    },
  });

  const initialData = await initialRes.json();
  const totalProducts = initialData.meta?.size || 18102;
  console.log(`2. Total products in MoySklad: ${totalProducts.toLocaleString('ru-RU')}`);

  const batchSize = 100;
  let offset = 0;
  let syncedCount = 0;
  const startTime = Date.now();

  while (offset < totalProducts) {
    try {
      const url = `${API_URL}/entity/product?limit=${batchSize}&offset=${offset}&expand=images,attributes`;
      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
          'Accept-Encoding': 'gzip',
        },
      });

      if (!res.ok) {
        console.warn(`[Retry] MoySklad rate limit / error ${res.status}. Waiting 2s...`);
        await new Promise((r) => setTimeout(r, 2000));
        continue;
      }

      const data = await res.json();
      const rows = data.rows || [];
      if (rows.length === 0) break;

      const records = rows.map((p) => {
        const cleanOem = extractCleanOem(p.code, p.article, p.name);

        // Brand attribute
        let brand = 'Koma Auto';
        if (p.attributes) {
          const bAttr = p.attributes.find((a) => a.name?.toLowerCase() === 'бренд');
          if (bAttr && bAttr.value) {
            brand = typeof bAttr.value === 'object' ? bAttr.value.name : String(bAttr.value);
          }
        }
        if (brand === 'Koma Auto' || !brand) {
          if (p.code?.endsWith('org')) brand = 'Hyundai';
          else if (p.code?.endsWith('mob')) brand = 'Mobis';
          else if (p.code?.endsWith('gm') || p.code?.endsWith('gmq')) brand = 'GM';
          else if (p.code?.endsWith('uz') || p.code?.endsWith('buz')) brand = 'GM Korea';
          else if (/toyota/i.test(p.name)) brand = 'Toyota';
          else if (/mando/i.test(p.name)) brand = 'Mando';
          else if (/ctr/i.test(p.name)) brand = 'CTR';
          else if (/sangsin|hi-q/i.test(p.name)) brand = 'Sangsin';
        }

        const priceVal = p.salePrices?.[0]?.value ? p.salePrices[0].value / 100 : 0;
        const oldPriceVal = p.salePrices?.[1]?.value ? p.salePrices[1].value / 100 : null;

        // Stock quantity (estimated from availability)
        const inStock = priceVal >= 500;
        const stockQuantity = inStock ? 5 : 0;

        // Image
        let image = '';
        const images = [];
        if (p.images && p.images.rows && p.images.rows.length > 0) {
          const href = p.images.rows[0].meta?.downloadHref;
          if (href) {
            image = `/api/images?href=${encodeURIComponent(href)}`;
            images.push(image);
          }
        }
        if (!image) {
          image = `/api/images/placeholder?name=${encodeURIComponent(p.name)}&oem=${encodeURIComponent(cleanOem)}&brand=${encodeURIComponent(brand)}`;
          images.push(image);
        }

        const compat = extractCompatibility(p.name, p.code, cleanOem);

        return {
          id: p.id,
          title: p.name,
          price: priceVal,
          old_price: oldPriceVal,
          stock_quantity: stockQuantity,
          in_stock: inStock,
          brand,
          category: 'Автозапчасти',
          original_oem: p.code || p.article || null,
          clean_oem_number: cleanOem,
          image,
          images: JSON.stringify(images),
          specs: JSON.stringify({
            'Артикул': p.article || '—',
            'Код детали': p.code || '—',
            'Производитель': brand,
          }),
          compatibility: JSON.stringify(compat),
          description: p.description || null,
        };
      });

      // Upsert batch into PostgreSQL
      await sql`
        INSERT INTO my_sklad_products ${sql(records)}
        ON CONFLICT (id) DO UPDATE SET
          title = EXCLUDED.title,
          price = EXCLUDED.price,
          old_price = EXCLUDED.old_price,
          stock_quantity = EXCLUDED.stock_quantity,
          in_stock = EXCLUDED.in_stock,
          brand = EXCLUDED.brand,
          clean_oem_number = EXCLUDED.clean_oem_number,
          image = EXCLUDED.image,
          images = EXCLUDED.images,
          specs = EXCLUDED.specs,
          compatibility = EXCLUDED.compatibility,
          updated_at = NOW();
      `;

      syncedCount += rows.length;
      offset += rows.length;

      const elapsedSec = (Date.now() - startTime) / 1000;
      const pct = ((syncedCount / totalProducts) * 100).toFixed(1);
      const itemsPerSec = (syncedCount / elapsedSec).toFixed(1);
      const remainingSec = Math.round((totalProducts - syncedCount) / (itemsPerSec || 1));

      process.stdout.write(
        `\r[Progress] ${syncedCount.toLocaleString('ru-RU')} / ${totalProducts.toLocaleString('ru-RU')} (${pct}%) | ${itemsPerSec} items/sec | ETA: ${remainingSec}s    `
      );
    } catch (batchErr) {
      console.error('\nBatch error, retrying in 3s:', batchErr.message);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  console.log(`\n\n=== SUCCESS: Synced ${syncedCount.toLocaleString('ru-RU')} products into PostgreSQL! ===`);
  await sql.end();
}

run().catch((err) => {
  console.error('\nFatal error during sync:', err);
  process.exit(1);
});
