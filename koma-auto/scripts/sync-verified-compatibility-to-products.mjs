import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function syncVerifiedCompatibility() {
  console.log('Syncing verified compatibility from cross-table into my_sklad_products...');

  // Fetch all crosses joined with vehicle catalog
  const crosses = await sql`
    SELECT 
      pvc.clean_oem,
      vc.make,
      vc.model,
      vc.generation,
      vc.body_code,
      vc.engines
    FROM product_vehicle_crosses pvc
    JOIN vehicle_catalog vc ON pvc.vehicle_id = vc.id
    ORDER BY pvc.clean_oem, vc.make, vc.model;
  `;

  // Group by clean_oem
  const oemMap = new Map();
  for (const c of crosses) {
    if (!oemMap.has(c.clean_oem)) {
      oemMap.set(c.clean_oem, []);
    }
    oemMap.get(c.clean_oem).push({
      make: c.make,
      model: c.model,
      generation: c.generation,
      bodyCode: c.body_code,
      engines: c.engines || [],
    });
  }

  console.log(`Found ${oemMap.size} unique OEMs with verified vehicle data.`);

  let updatedProductsCount = 0;
  for (const [cleanOem, vehicles] of oemMap.entries()) {
    // Format into Drom strings: "Make Model | Generation | BodyCode" + engines
    const compatStrings = [];
    const allEngines = new Set();

    for (const v of vehicles) {
      compatStrings.push(`${v.make} ${v.model} | ${v.generation} | ${v.bodyCode || ''}`);
      if (Array.isArray(v.engines)) {
        v.engines.forEach(e => allEngines.add(e));
      }
    }

    if (allEngines.size > 0) {
      compatStrings.push(`Для двигателей: ${Array.from(allEngines).join(', ')}`);
    }

    const res = await sql`
      UPDATE my_sklad_products
      SET compatibility = ${JSON.stringify(compatStrings)}::jsonb
      WHERE clean_oem_number = ${cleanOem} OR clean_oem_number = ${cleanOem + 'ORG'} OR clean_oem_number = ${cleanOem + 'MOB'};
    `;
    updatedProductsCount += res.count;
  }

  console.log(`Successfully updated ${updatedProductsCount} products with verified Drom-style compatibility!`);

  // Verify sample
  const sample = await sql`
    SELECT title, clean_oem_number, compatibility 
    FROM my_sklad_products 
    WHERE compatibility::text != '[]' 
    LIMIT 3;
  `;
  console.log('Sample verified products:', JSON.stringify(sample, null, 2));

  await sql.end();
}

syncVerifiedCompatibility().catch(console.error);
