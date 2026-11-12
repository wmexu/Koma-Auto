import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';
import {
  isNeonStorageConfigured,
  getImageFromStorage,
  uploadImageToStorage,
  compressToWebp,
  extractPhotoKey,
  getStoragePublicUrl,
  MAX_PHOTO_BYTES,
} from '../lib/neon-storage.ts';

// 1. Read .env.local
const envPath = path.resolve('.env.local');
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
        if (!process.env[trimmed.slice(0, idx).trim()]) {
          process.env[trimmed.slice(0, idx).trim()] = val;
        }
      }
    });
}

const DATABASE_URL = process.env.DATABASE_URL;
const MOYSKLAD_TOKEN = process.env.MOYSKLAD_TOKEN;

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env.local');
  process.exit(1);
}

if (!MOYSKLAD_TOKEN) {
  console.error('Missing MOYSKLAD_TOKEN in .env.local');
  process.exit(1);
}

if (!isNeonStorageConfigured()) {
  console.error('Neon Object Storage credentials missing');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 5 });

const SLEEP_MS = 400; // Strict <= 2.5 req/sec (MoySklad allows 15 req/sec, completely safe!)

async function sleep(ms = SLEEP_MS) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchWithRetry(url, options = {}, retries = 3) {
  let attempt = 0;
  while (attempt < retries) {
    attempt++;
    try {
      const res = await fetch(url, options);
      if (res.status === 429) {
        const retryAfter = Number(res.headers.get('X-Lognex-Retry-TimeInterval')) || 3500;
        console.warn(`[429 Rate Limit] MoySklad requested backoff: ${retryAfter}ms. Waiting...`);
        await sleep(retryAfter);
        continue;
      }
      return res;
    } catch (netErr) {
      console.warn(`[Network Retry ${attempt}/${retries}] ${netErr.message}. Waiting 1.5s...`);
      await sleep(1500);
      if (attempt >= retries) throw netErr;
    }
  }
  return fetch(url, options);
}

async function main() {
  console.log('================================================================');
  console.log('  KOMA AUTO - NEON OBJECT STORAGE & WEBP COMPRESSION ENGINE');
  console.log('  Target size per photo: <= 21.16 KB (21,667 bytes)');
  console.log('  MoySklad API rate limit: 2.5 req/sec (safe 400ms pacing)');
  console.log('================================================================\n');

  // Verify token first
  console.log('1. Checking MoySklad API token...');
  const pingRes = await fetchWithRetry('https://api.moysklad.ru/api/remap/1.2/entity/product?limit=1', {
    headers: { Authorization: `Bearer ${MOYSKLAD_TOKEN}` },
  });
  if (!pingRes.ok) {
    console.error(`MoySklad token error: HTTP ${pingRes.status}`);
    process.exit(1);
  }
  console.log('✓ MoySklad token is valid and active!\n');

  let totalUploaded = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  let totalSavedBytes = 0;
  let totalStoredBytes = 0;

  // -------------------------------------------------------------
  // PHASE 1: Sync products that already have image links in Neon DB
  // -------------------------------------------------------------
  console.log('--- PHASE 1: Syncing existing photo links from Neon DB ---');
  const existingRows = await sql`
    SELECT id, title, image, images
    FROM my_sklad_products
    WHERE image IS NOT NULL AND image != ''
    ORDER BY id ASC;
  `;
  console.log(`Found ${existingRows.length} products with photo links in Neon DB.\n`);

  for (let i = 0; i < existingRows.length; i++) {
    const item = existingRows[i];
    let downloadHref = item.image;
    if (downloadHref.includes('href=')) {
      downloadHref = decodeURIComponent(downloadHref.split('href=')[1].split('&')[0]);
    }

    if (!downloadHref || !downloadHref.startsWith('https://api.moysklad.ru/')) {
      continue;
    }

    const photoKey = extractPhotoKey(downloadHref);
    const storageKey = `products/${photoKey}.webp`;

    // 1. Check if already uploaded
    const existingObj = await getImageFromStorage(storageKey);
    if (existingObj) {
      totalSkipped++;
      if (totalSkipped % 50 === 0 || i === existingRows.length - 1) {
        console.log(`[Phase 1: ${i + 1}/${existingRows.length}] Already in Neon S3: ${storageKey}`);
      }
      continue;
    }

    // 2. Download from MoySklad
    try {
      const res = await fetchWithRetry(downloadHref, {
        headers: {
          Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
          'Accept-Encoding': 'gzip',
        },
      });

      if (!res.ok) {
        totalErrors++;
        console.warn(`[Phase 1: ${i + 1}/${existingRows.length}] MoySklad HTTP ${res.status} for "${item.title.slice(0, 35)}"`);
        await sleep();
        continue;
      }

      const rawBuffer = Buffer.from(await res.arrayBuffer());
      const webpBuffer = await compressToWebp(rawBuffer, MAX_PHOTO_BYTES);

      await uploadImageToStorage(storageKey, webpBuffer, 'image/webp');
      totalUploaded++;
      totalStoredBytes += webpBuffer.length;
      totalSavedBytes += Math.max(0, rawBuffer.length - webpBuffer.length);

      const ratio = (((rawBuffer.length - webpBuffer.length) / rawBuffer.length) * 100).toFixed(1);
      const isUnderLimit = webpBuffer.length <= MAX_PHOTO_BYTES;

      console.log(
        `[Phase 1: ${i + 1}/${existingRows.length}] ✓ Uploaded ${storageKey} | ${(rawBuffer.length / 1024).toFixed(0)}KB -> ${(webpBuffer.length / 1024).toFixed(2)}KB (-${ratio}%) | <=21.16KB: ${isUnderLimit ? '✓' : '✗'}`
      );

      await sleep();
    } catch (err) {
      totalErrors++;
      console.error(`[Phase 1: ${i + 1}/${existingRows.length}] Error on ${storageKey}:`, err.message);
      await sleep();
    }
  }

  console.log(`\nPhase 1 Complete: ${totalUploaded} uploaded, ${totalSkipped} already existed, ${totalErrors} errors.\n`);

  // -------------------------------------------------------------
  // PHASE 2: Scan MoySklad in batches of 100 to discover new photos
  // -------------------------------------------------------------
  console.log('--- PHASE 2: Scanning MoySklad (batches of 100) for newly added photos ---');
  
  // Get total count of products in MoySklad
  const countRes = await fetchWithRetry('https://api.moysklad.ru/api/remap/1.2/entity/product?limit=1', {
    headers: { Authorization: `Bearer ${MOYSKLAD_TOKEN}` },
  });
  const countData = await countRes.json();
  const totalInMoySklad = countData.meta?.size || 18170;
  console.log(`Total products in MoySklad: ${totalInMoySklad.toLocaleString('ru-RU')}`);

  const BATCH_SIZE = 100;
  let newlyDiscovered = 0;

  for (let offset = 0; offset < totalInMoySklad; offset += BATCH_SIZE) {
    const url = `https://api.moysklad.ru/api/remap/1.2/entity/product?limit=${BATCH_SIZE}&offset=${offset}&expand=images`;
    let batchRes;
    try {
      batchRes = await fetchWithRetry(url, {
        headers: {
          Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
          'Accept-Encoding': 'gzip',
        },
      });
    } catch (e) {
      console.warn(`[Batch ${offset}] Network error, waiting 2s...`);
      await sleep(2000);
      continue;
    }

    if (!batchRes.ok) {
      console.warn(`[Batch ${offset}] HTTP ${batchRes.status}, skipping.`);
      await sleep();
      continue;
    }

    const batchData = await batchRes.json();
    const rows = batchData.rows || [];
    if (rows.length === 0) break;

    for (const p of rows) {
      if (p.images && p.images.rows && p.images.rows.length > 0) {
        const imageRows = p.images.rows;
        const validHrefs = imageRows
          .map((img) => img.meta?.downloadHref)
          .filter((href) => Boolean(href));

        if (validHrefs.length === 0) continue;

        const firstHref = validHrefs[0];
        const photoKey = extractPhotoKey(firstHref);
        const storageKey = `products/${photoKey}.webp`;

        // Check if we need to upload and update DB
        const existsInStorage = await getImageFromStorage(storageKey);
        if (!existsInStorage) {
          try {
            const imgRes = await fetchWithRetry(firstHref, {
              headers: { Authorization: `Bearer ${MOYSKLAD_TOKEN}`, 'Accept-Encoding': 'gzip' },
            });
            if (imgRes.ok) {
              const rawBuf = Buffer.from(await imgRes.arrayBuffer());
              const webpBuf = await compressToWebp(rawBuf, MAX_PHOTO_BYTES);
              await uploadImageToStorage(storageKey, webpBuf, 'image/webp');
              totalUploaded++;
              newlyDiscovered++;
              totalStoredBytes += webpBuf.length;

              console.log(
                `[Discovered Photo] "${p.name?.slice(0, 35)}" -> ${storageKey} (${(webpBuf.length / 1024).toFixed(2)} KB)`
              );
              await sleep();
            }
          } catch (uploadErr) {
            console.warn(`Failed uploading photo for ${p.id}:`, uploadErr.message);
          }
        }

        // Always ensure Neon DB has the proper image links
        const primaryImage = `/api/images?href=${encodeURIComponent(firstHref)}`;
        const allImages = validHrefs.map((href) => `/api/images?href=${encodeURIComponent(href)}`);

        await sql`
          UPDATE my_sklad_products
          SET 
            image = ${primaryImage},
            images = ${JSON.stringify(allImages)}::jsonb,
            updated_at = NOW()
          WHERE id = ${p.id} AND (image IS NULL OR image = '' OR image != ${primaryImage});
        `;
      }
    }

    const progressPct = (((offset + rows.length) / totalInMoySklad) * 100).toFixed(1);
    process.stdout.write(
      `\r[Scan Progress] ${offset + rows.length} / ${totalInMoySklad} (${progressPct}%) | Newly synced: ${newlyDiscovered}    `
    );

    await sleep();
  }

  console.log('\n\n================================================================');
  console.log('SYNC COMPLETE!');
  console.log(`- Total images uploaded to Neon Object Storage: ${totalUploaded}`);
  console.log(`- Total images verified in storage: ${totalSkipped + totalUploaded}`);
  console.log(`- Newly discovered products with photos: ${newlyDiscovered}`);
  console.log(`- Total storage used: ${(totalStoredBytes / 1024 / 1024).toFixed(2)} MB`);
  if (totalUploaded > 0) {
    console.log(`- Average photo size: ${(totalStoredBytes / totalUploaded / 1024).toFixed(2)} KB (Target: <= 21.16 KB)`);
    console.log(`- Total bandwidth saved: ${(totalSavedBytes / 1024 / 1024).toFixed(2)} MB`);
  }
  console.log('================================================================\n');

  await sql.end();
}

main().catch(async (err) => {
  console.error('\nFatal sync error:', err);
  await sql.end();
  process.exit(1);
});
