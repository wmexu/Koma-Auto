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
  console.error('Missing DATABASE_URL');
  process.exit(1);
}

if (!isNeonStorageConfigured()) {
  console.error('Neon Object Storage credentials missing');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 5 });

async function main() {
  console.log('=== NEON OBJECT STORAGE IMAGE SYNC & WEBP COMPRESSION ENGINE ===\n');

  const rows = await sql`
    SELECT id, title, image, images
    FROM my_sklad_products
    WHERE image IS NOT NULL AND image != ''
    ORDER BY id ASC;
  `;

  console.log(`Found ${rows.length} products with images in Neon DB.`);

  let alreadyInStorage = 0;
  let newlyUploaded = 0;
  let failed = 0;
  let totalSavedBytes = 0;
  let totalWebpBytes = 0;

  for (let i = 0; i < rows.length; i++) {
    const item = rows[i];
    const rawImage = item.image;
    if (!rawImage) continue;

    // Extract MoySklad download href
    let downloadHref = rawImage;
    if (rawImage.includes('href=')) {
      const parts = rawImage.split('href=');
      downloadHref = decodeURIComponent(parts[1]?.split('&')[0] || '');
    }

    if (!downloadHref || !downloadHref.startsWith('https://api.moysklad.ru/')) {
      continue;
    }

    const photoKey = extractPhotoKey(downloadHref);
    const storageKey = `products/${photoKey}.webp`;

    // 1. Check if already uploaded to Neon Storage
    const existing = await getImageFromStorage(storageKey);
    if (existing) {
      alreadyInStorage++;
      if (i % 25 === 0) {
        console.log(`[${i + 1}/${rows.length}] Already in Neon S3: ${storageKey}`);
      }
      continue;
    }

    // 2. Fetch from MoySklad with rate-limit pacing (<= 3 req/sec)
    try {
      const res = await fetch(downloadHref, {
        headers: {
          Authorization: `Bearer ${MOYSKLAD_TOKEN}`,
          'Accept-Encoding': 'gzip',
        },
      });

      if (!res.ok) {
        failed++;
        console.warn(`[${i + 1}/${rows.length}] MoySklad HTTP ${res.status} for ${item.title.slice(0, 30)}`);
        if (res.status === 403) {
          console.warn('\n[!] MoySklad token has no API access (403 Forbidden). Stopping sync gracefully to avoid unnecessary attempts.');
          break;
        }
        await new Promise((r) => setTimeout(r, 350));
        continue;
      }

      const rawBuffer = Buffer.from(await res.arrayBuffer());
      const webpBuffer = await compressToWebp(rawBuffer, 800, 78);

      await uploadImageToStorage(storageKey, webpBuffer, 'image/webp');
      newlyUploaded++;
      totalWebpBytes += webpBuffer.length;
      totalSavedBytes += Math.max(0, rawBuffer.length - webpBuffer.length);

      const ratio = (((rawBuffer.length - webpBuffer.length) / rawBuffer.length) * 100).toFixed(0);
      console.log(
        `[${i + 1}/${rows.length}] ✓ Uploaded ${storageKey} (${(rawBuffer.length / 1024).toFixed(0)}KB -> ${(webpBuffer.length / 1024).toFixed(0)}KB, -${ratio}%)`
      );

      // Pacing delay (<= 3 req/sec)
      await new Promise((r) => setTimeout(r, 350));
    } catch (err) {
      failed++;
      console.error(`[${i + 1}/${rows.length}] Failed processing ${storageKey}:`, err.message);
      await new Promise((r) => setTimeout(r, 350));
    }
  }

  console.log('\n================================================================');
  console.log('SUMMARY:');
  console.log(`- Total checked: ${rows.length}`);
  console.log(`- Already in Neon S3: ${alreadyInStorage}`);
  console.log(`- Newly uploaded: ${newlyUploaded}`);
  console.log(`- Failed / MoySklad forbidden: ${failed}`);
  if (newlyUploaded > 0) {
    console.log(`- Total WebP stored: ${(totalWebpBytes / 1024).toFixed(1)} KB`);
    console.log(`- Total bandwidth saved: ${(totalSavedBytes / 1024).toFixed(1)} KB`);
  }
  console.log('================================================================\n');

  await sql.end();
}

main().catch(console.error);
