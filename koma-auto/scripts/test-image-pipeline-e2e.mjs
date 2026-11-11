import {
  isNeonStorageConfigured,
  getImageFromStorage,
  uploadImageToStorage,
  compressToWebp,
  extractPhotoKey,
  getStoragePublicUrl,
} from '../lib/neon-storage.ts';
import sharp from 'sharp';

async function main() {
  console.log('=== TESTING NEON OBJECT STORAGE IMAGE PIPELINE ===\n');

  console.log('1. Checking storage configuration...');
  console.log('Is configured:', isNeonStorageConfigured());
  if (!isNeonStorageConfigured()) {
    throw new Error('Neon storage is not configured');
  }

  // 2. Generate a realistic auto-part placeholder image (e.g. brake pad simulation)
  console.log('\n2. Creating test automotive graphic...');
  const svg = `
    <svg width="1200" height="1200" viewBox="0 0 1200 1200" xmlns="http://www.w3.org/2000/svg">
      <rect width="100%" height="100%" fill="#FFFFFF"/>
      <rect x="200" y="300" width="800" height="450" rx="40" fill="#202A44" stroke="#161F36" stroke-width="12"/>
      <circle cx="350" cy="525" r="50" fill="#E2E8F0"/>
      <circle cx="850" cy="525" r="50" fill="#E2E8F0"/>
      <text x="600" y="550" font-family="Arial, sans-serif" font-size="52" font-weight="bold" fill="#00E5FF" text-anchor="middle">KOMA AUTO</text>
      <text x="600" y="620" font-family="Arial, sans-serif" font-size="28" fill="#CBD5E1" text-anchor="middle">GENUINE OEM PART VERIFIED</text>
      <rect x="250" y="800" width="700" height="80" rx="16" fill="#F1F5F9"/>
      <text x="600" y="850" font-family="Arial, sans-serif" font-size="24" fill="#64748B" text-anchor="middle">OEM: 58101-2SA00 | Hyundai/Kia</text>
    </svg>
  `;

  const rawPngBuffer = await sharp(Buffer.from(svg)).png().toBuffer();
  console.log(`Raw PNG size: ${(rawPngBuffer.length / 1024).toFixed(1)} KB`);

  // 3. Compress to WebP
  console.log('\n3. Compressing to WebP (max 800x800, Q=78)...');
  const t0 = Date.now();
  const webpBuffer = await compressToWebp(rawPngBuffer, 800, 78);
  const compressMs = Date.now() - t0;
  console.log(`Compressed WebP size: ${(webpBuffer.length / 1024).toFixed(1)} KB (Elapsed: ${compressMs}ms)`);
  console.log(`Compression ratio: -${(((rawPngBuffer.length - webpBuffer.length) / rawPngBuffer.length) * 100).toFixed(1)}%`);

  // 4. Test photo key extraction
  const sampleDownloadHref = 'https://api.moysklad.ru/api/remap/1.2/download/c53d91cc-9624-4ed8-ae89-cccd6c59aacf';
  const photoKey = extractPhotoKey(sampleDownloadHref);
  const storageKey = `products/${photoKey}.webp`;
  console.log(`\n4. Extracted photo key: ${photoKey}`);
  console.log(`Target storage key: ${storageKey}`);

  // 5. Upload to Neon Object Storage
  console.log('\n5. Uploading to Neon Object Storage bucket "assets"...');
  const publicUrl = await uploadImageToStorage(storageKey, webpBuffer, 'image/webp');
  console.log('Upload success! Direct Public URL:', publicUrl);

  // 6. Test direct HTTPS fetch without auth
  console.log('\n6. Testing direct HTTPS public read from Neon Storage...');
  const directRes = await fetch(publicUrl);
  console.log(`Direct fetch HTTP status: ${directRes.status}`);
  console.log(`Direct fetch content-type: ${directRes.headers.get('content-type')}`);
  console.log(`Direct fetch cache-control: ${directRes.headers.get('cache-control')}`);
  const directBytes = await directRes.arrayBuffer();
  console.log(`Direct fetch downloaded bytes: ${directBytes.byteLength}`);

  if (directRes.status !== 200 || directBytes.byteLength !== webpBuffer.byteLength) {
    throw new Error(`Direct fetch verification failed! HTTP: ${directRes.status}`);
  }

  // 7. Test GetObject from SDK
  console.log('\n7. Testing getImageFromStorage SDK read...');
  const retrieved = await getImageFromStorage(storageKey);
  if (!retrieved || retrieved.buffer.length !== webpBuffer.byteLength) {
    throw new Error('getImageFromStorage SDK verification failed!');
  }
  console.log(`Retrieved from SDK: ${retrieved.buffer.length} bytes, type: ${retrieved.contentType}`);

  console.log('\n=== ALL IMAGE PIPELINE TESTS PASSED 100%! ===\n');
}

main().catch((err) => {
  console.error('\nTest failed:', err);
  process.exit(1);
});
