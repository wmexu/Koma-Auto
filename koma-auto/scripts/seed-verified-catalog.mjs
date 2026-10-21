import dns from 'node:dns';
dns.setDefaultResultOrder('ipv4first');
import postgres from 'postgres';

const sql = postgres(process.env.DATABASE_URL, { max: 1 });

async function seedVerifiedCatalog() {
  console.log('Seeding verified vehicle catalog and OEM crosses...');

  // 1. Fetch existing vehicles
  const existingVehicles = await sql`SELECT id, make, model, generation FROM vehicle_catalog`;
  const vehicleIdMap = new Map();
  for (const ev of existingVehicles) {
    vehicleIdMap.set(`${ev.make}_${ev.model}_${ev.generation}`, ev.id);
  }
  console.log(`Loaded ${vehicleIdMap.size} vehicles from DB.`);

  // 2. Verified OEM Cross Mapping: OEM ➔ List of vehicle keys
  const crosses = [
    // Front Brake Pads Accent RB / Rio UB
    {
      oems: ['581014LA00', '581011RA00', '581010UA00', '581014LA00ORG', '581014LA00MOB', '581014LA00CTR'],
      vehicles: [
        'Hyundai_Accent_4 поколение (2010–2017)',
        'Hyundai_Solaris_1 поколение (2010–2017)',
        'Kia_Rio_3 поколение (2011–2017)'
      ]
    },
    // Front Brake Pads Accent HC / Rio FB
    {
      oems: ['58101H8A00', '58101H5A25', '58101H8A00ORG'],
      vehicles: [
        'Hyundai_Accent_5 поколение (2017–2022)',
        'Hyundai_Solaris_2 поколение (2017–2022)',
        'Kia_Rio_4 поколение (2017–2022)'
      ]
    },
    // Front Brake Pads ix35 / Sportage SL
    {
      oems: ['581012SA00', '581012SA70', '581012SA50', '581012SA00ORG'],
      vehicles: [
        'Hyundai_ix35_2 поколение (2010–2015)',
        'Kia_Sportage_3 поколение (2010–2016)'
      ]
    },
    // Front Brake Pads Cerato TD
    {
      oems: ['581011MA00', '581012KA00'],
      vehicles: [
        'Kia_Cerato_2 поколение (2008–2013)'
      ]
    },
    // Front Brake Pads Cerato LD
    {
      oems: ['581012FA00', '581012FA10'],
      vehicles: [
        'Kia_Cerato_1 поколение, рестайлинг (2005–2008)',
        'Kia_Cerato_1 поколение (2004–2008)'
      ]
    },
    // Rear Brake Pads Accent RB / Rio UB
    {
      oems: ['583021RA30', '583020UA00', '583021RA30ORG'],
      vehicles: [
        'Hyundai_Accent_4 поколение (2010–2017)',
        'Hyundai_Solaris_1 поколение (2010–2017)',
        'Kia_Rio_3 поколение (2011–2017)'
      ]
    },
    // Rear Brake Pads ix35 / Sportage SL
    {
      oems: ['583022SA00', '583022SA70'],
      vehicles: [
        'Hyundai_ix35_2 поколение (2010–2015)',
        'Kia_Sportage_3 поколение (2010–2016)'
      ]
    },
    // Universal Oil Filter Hyundai / Kia
    {
      oems: ['2630035505', '2630035504', '2630035503', '2630035500', '2630035505ORG'],
      vehicles: [
        'Hyundai_Accent_4 поколение (2010–2017)',
        'Hyundai_Solaris_1 поколение (2010–2017)',
        'Hyundai_Accent_5 поколение (2017–2022)',
        'Hyundai_Solaris_2 поколение (2017–2022)',
        'Kia_Rio_3 поколение (2011–2017)',
        'Kia_Rio_4 поколение (2017–2022)',
        'Hyundai_Elantra_5 поколение (2010–2016)',
        'Kia_Cerato_2 поколение (2008–2013)',
        'Kia_Cerato_3 поколение (2012–2020)',
        'Hyundai_Tucson_1 поколение (2004–2010)',
        'Hyundai_ix35_2 поколение (2010–2015)',
        'Kia_Sportage_3 поколение (2010–2016)'
      ]
    },
    // Air Filter Accent RB / Rio UB
    {
      oems: ['281131R100', '28113B9100', '281131R100ORG'],
      vehicles: [
        'Hyundai_Accent_4 поколение (2010–2017)',
        'Hyundai_Solaris_1 поколение (2010–2017)',
        'Kia_Rio_3 поколение (2011–2017)'
      ]
    },
    // Cabin Filter Accent RB / Rio UB
    {
      oems: ['971334L000', '97133D1000', '971334L000ORG'],
      vehicles: [
        'Hyundai_Accent_4 поколение (2010–2017)',
        'Hyundai_Solaris_1 поколение (2010–2017)',
        'Kia_Rio_3 поколение (2011–2017)'
      ]
    },
    // Front Stabilizer Link Accent RB / Rio UB
    {
      oems: ['548300U000', '548304L000', '548300U000CTR', '548300U000ORG'],
      vehicles: [
        'Hyundai_Accent_4 поколение (2010–2017)',
        'Hyundai_Solaris_1 поколение (2010–2017)',
        'Kia_Rio_3 поколение (2011–2017)'
      ]
    },
    // Front Stabilizer Link ix35 / Sportage SL
    {
      oems: ['548302S000', '548302S000CTR', '548302S000ORG'],
      vehicles: [
        'Hyundai_ix35_2 поколение (2010–2015)',
        'Kia_Sportage_3 поколение (2010–2016)'
      ]
    },
    // Rear Stabilizer Link ix35 / Sportage SL
    {
      oems: ['548402S000', '548402S000CTR'],
      vehicles: [
        'Hyundai_ix35_2 поколение (2010–2015)',
        'Kia_Sportage_3 поколение (2010–2016)'
      ]
    },
    // Control Arm Bushings ix35 / Sportage SL
    {
      oems: ['545842S000', '545512S000'],
      vehicles: [
        'Hyundai_ix35_2 поколение (2010–2015)',
        'Kia_Sportage_3 поколение (2010–2016)'
      ]
    },
    // Tie Rod Ends Accent RB / Rio UB
    {
      oems: ['568204L000', '568204L090'],
      vehicles: [
        'Hyundai_Accent_4 поколение (2010–2017)',
        'Hyundai_Solaris_1 поколение (2010–2017)',
        'Kia_Rio_3 поколение (2011–2017)'
      ]
    },
    // Tie Rod Ends Sonata LF / Optima JF
    {
      oems: ['56820C1000', '56820C1090'],
      vehicles: [
        'Hyundai_Sonata_7 поколение (2014–2019)',
        'Kia_Optima_4 поколение (2015–2020)'
      ]
    },
    // Valve Cover Gasket Gamma 1.4 / 1.6
    {
      oems: ['224412B000', '224412B002'],
      vehicles: [
        'Hyundai_Accent_4 поколение (2010–2017)',
        'Hyundai_Solaris_1 поколение (2010–2017)',
        'Kia_Rio_3 поколение (2011–2017)',
        'Hyundai_Elantra_5 поколение (2010–2016)',
        'Kia_Cerato_2 поколение (2008–2013)',
        'Kia_Cerato_3 поколение (2012–2020)'
      ]
    },
    // Thermostat Housing Cap Nu 2.0L
    {
      oems: ['256312E650'],
      vehicles: [
        'Hyundai_ix35_2 поколение (2010–2015)',
        'Hyundai_Tucson_3 поколение (2015–2021)',
        'Hyundai_Elantra_5 поколение (2010–2016)',
        'Kia_Sportage_3 поколение (2010–2016)',
        'Kia_Sportage_4 поколение (2015–2021)',
        'Kia_Cerato_3 поколение (2012–2020)'
      ]
    },
    // Wheel Bearing Nexia / Lanos / Aveo
    {
      oems: ['94535247', '94535247ORG'],
      vehicles: [
        'Daewoo_Nexia_1 поколение (1995–2008)',
        'Daewoo_Nexia_1 поколение, рестайлинг (2008–2016)',
        'Daewoo_Lanos_1 поколение (1997–2008)',
        'Chevrolet_Aveo_1 поколение (2003–2011)'
      ]
    },
    // Front Brake Pads Aveo
    {
      oems: ['96535010', '96535011'],
      vehicles: [
        'Chevrolet_Aveo_1 поколение (2003–2011)'
      ]
    },
    // Timing Belt Lacetti / Gentra / Cruze
    {
      oems: ['96415057', '96415058'],
      vehicles: [
        'Chevrolet_Lacetti_1 поколение (2003–2014)',
        'Daewoo_Gentra_1 поколение (2013–2018)',
        'Chevrolet_Cruze_1 поколение (2009–2016)'
      ]
    },
    // Exhaust Manifold Gasket GM Ecotec
    {
      oems: ['55568787'],
      vehicles: [
        'Chevrolet_Cruze_1 поколение (2009–2016)',
        'Chevrolet_Aveo_2 поколение (2011–2018)'
      ]
    },
    // Front Brake Pads Lacetti / Gentra
    {
      oems: ['96473229'],
      vehicles: [
        'Chevrolet_Lacetti_1 поколение (2003–2014)',
        'Daewoo_Gentra_1 поколение (2013–2018)'
      ]
    },
    // Ignition Coil Nexia / Lanos
    {
      oems: ['96353002'],
      vehicles: [
        'Daewoo_Nexia_1 поколение (1995–2008)',
        'Daewoo_Nexia_1 поколение, рестайлинг (2008–2016)',
        'Daewoo_Lanos_1 поколение (1997–2008)'
      ]
    },
  ];

  const rowsToInsert = [];
  for (const group of crosses) {
    for (const oem of group.oems) {
      for (const vKey of group.vehicles) {
        const vId = vehicleIdMap.get(vKey);
        if (vId) {
          rowsToInsert.push({ clean_oem: oem, vehicle_id: vId });
        }
      }
    }
  }

  console.log(`Inserting ${rowsToInsert.length} cross records in single bulk query...`);
  if (rowsToInsert.length > 0) {
    await sql`
      INSERT INTO product_vehicle_crosses ${sql(rowsToInsert, 'clean_oem', 'vehicle_id')}
      ON CONFLICT (clean_oem, vehicle_id) DO NOTHING;
    `;
  }

  const [totalCrosses] = await sql`SELECT count(*)::int as count FROM product_vehicle_crosses`;
  console.log(`Total verified crosses in Neon DB: ${totalCrosses.count}`);

  await sql.end();
}

seedVerifiedCatalog().catch(console.error);
