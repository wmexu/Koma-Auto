import dns from 'node:dns';
if (typeof dns.setDefaultResultOrder === 'function') {
  try { dns.setDefaultResultOrder('ipv4first'); } catch {}
}
import postgres from 'postgres';

async function testDatabaseE2E() {
  console.log('--- Testing Neon PostgreSQL Service E2E ---');
  const sql = postgres(process.env.DATABASE_URL, { max: 1 });

  const testId = 'test-neon-' + Date.now();
  const testProduct = {
    id: testId,
    title: 'Тестовая деталь Neon DB / Koma Auto',
    price: 15000,
    stockQuantity: 10,
    inStock: true,
    brand: 'MOBIS',
    category: 'Двигатель',
    originalOem: '22441-2B000',
    cleanOemNumber: '224412B000',
    image: null,
    images: JSON.stringify(['/test.jpg']),
    specs: JSON.stringify({ 'Тип': 'Прокладка клапанной крышки' }),
    compatibility: JSON.stringify([{ make: 'Hyundai', model: 'Accent / Solaris (RB)', years: '2010–2017' }]),
    description: 'Тестовая запись для валидации сквозной работы с Neon Lakebase Postgres',
  };

  try {
    console.log('1. Inserting test product into my_sklad_products...');
    await sql`
      INSERT INTO my_sklad_products (
        id, title, price, stock_quantity, in_stock, brand, category,
        original_oem, clean_oem_number, image, images, specs, compatibility, description
      ) VALUES (
        ${testProduct.id}, ${testProduct.title}, ${testProduct.price}, ${testProduct.stockQuantity},
        ${testProduct.inStock}, ${testProduct.brand}, ${testProduct.category}, ${testProduct.originalOem},
        ${testProduct.cleanOemNumber}, ${testProduct.image}, ${testProduct.images}::jsonb,
        ${testProduct.specs}::jsonb, ${testProduct.compatibility}::jsonb, ${testProduct.description}
      )
      ON CONFLICT (id) DO UPDATE SET updated_at = NOW();
    `;
    console.log('Insert OK.');

    console.log('2. Querying product by clean_oem_number (Fast Indexed Query)...');
    const t0 = performance.now();
    const rows = await sql`
      SELECT id, title, price, clean_oem_number, brand, in_stock, compatibility
      FROM my_sklad_products
      WHERE clean_oem_number = '224412B000'
      LIMIT 1;
    `;
    const duration = performance.now() - t0;
    console.log(`Query returned ${rows.length} row(s) in ${duration.toFixed(2)}ms:`);
    console.log(rows[0]);

    console.log('3. Cleaning up test row...');
    await sql`DELETE FROM my_sklad_products WHERE id = ${testId};`;
    console.log('Cleanup OK.');

    console.log('\n--- Neon PostgreSQL Service E2E PASSED! ---\n');
  } catch (err) {
    console.error('Neon DB E2E failed:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

testDatabaseE2E();
