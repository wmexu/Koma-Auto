import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function initCompatibilitySchema() {
  console.log('Creating vehicle_catalog and product_vehicle_crosses tables in Neon Postgres...');

  await sql`
    CREATE TABLE IF NOT EXISTS vehicle_catalog (
      id SERIAL PRIMARY KEY,
      make VARCHAR(60) NOT NULL,
      model VARCHAR(80) NOT NULL,
      generation VARCHAR(120) NOT NULL,
      body_code VARCHAR(80),
      engines TEXT[],
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS product_vehicle_crosses (
      id SERIAL PRIMARY KEY,
      clean_oem VARCHAR(60) NOT NULL,
      vehicle_id INT NOT NULL REFERENCES vehicle_catalog(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(clean_oem, vehicle_id)
    );
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_crosses_clean_oem ON product_vehicle_crosses(clean_oem);
  `;

  console.log('Tables created successfully.');
  await sql.end();
}

initCompatibilitySchema().catch(console.error);
