import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function check() {
  const [total] = await sql`SELECT count(*) FROM my_sklad_products`;
  const [inStock] = await sql`SELECT count(*) FROM my_sklad_products WHERE in_stock = true`;
  const brands = await sql`SELECT brand, count(*) as cnt FROM my_sklad_products GROUP BY brand ORDER BY cnt DESC LIMIT 8`;
  const samples = await sql`SELECT title, brand, clean_oem_number, compatibility FROM my_sklad_products WHERE compatibility::text != '[]' LIMIT 3`;

  console.log('--- NEON POSTGRESQL CATALOG STATS ---');
  console.log('Total products in Neon DB:', Number(total.count).toLocaleString('ru-RU'));
  console.log('Products in stock (Car City):', Number(inStock.count).toLocaleString('ru-RU'));
  console.log('\nTop brands:');
  console.table(brands);
  console.log('\nSample enriched products:');
  console.log(JSON.stringify(samples, null, 2));
  await sql.end();
}

check().catch(console.error);
