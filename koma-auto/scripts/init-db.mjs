import dns from 'node:dns';
if (typeof dns.setDefaultResultOrder === 'function') {
  try { dns.setDefaultResultOrder('ipv4first'); } catch {}
}
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL is missing in environment!');
    process.exit(1);
  }

  const sql = postgres(url, { max: 1, idle_timeout: 10 });
  try {
    console.log('Connecting to Neon PostgreSQL...');
    
    console.log('Creating my_sklad_products table...');
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

    console.log('Creating performance indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_ms_clean_oem ON my_sklad_products(clean_oem_number);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ms_brand ON my_sklad_products(brand);`;
    await sql`CREATE INDEX IF NOT EXISTS idx_ms_in_stock ON my_sklad_products(in_stock);`;

    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    console.log('Public tables in Neon neondb:');
    console.table(tables);

    const count = await sql`SELECT count(*) FROM my_sklad_products;`;
    console.log('Current rows in my_sklad_products:', count[0].count);
  } catch (err) {
    console.error('Database initialization failed:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
