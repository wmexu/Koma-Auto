import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL);

async function run() {
  await sql.unsafe(`
    CREATE TABLE IF NOT EXISTS discounted_products (
      id VARCHAR(255) PRIMARY KEY,
      product_id VARCHAR(255) NOT NULL REFERENCES my_sklad_products(id) ON DELETE CASCADE,
      discount_type VARCHAR(50) NOT NULL,
      value_type VARCHAR(20) NOT NULL,
      discount_value NUMERIC NOT NULL,
      original_price NUMERIC NOT NULL,
      discounted_price NUMERIC NOT NULL,
      display_old_price NUMERIC,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_discounted_prod_id ON discounted_products(product_id);
  `);
  console.log('discounted_products table created successfully');
  await sql.end();
}

run().catch(console.error);
