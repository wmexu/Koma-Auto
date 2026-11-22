const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

// Read .env.local manually
const envPath = path.resolve(process.cwd(), '.env.local');
const envContent = fs.readFileSync(envPath, 'utf8');
let dbUrl = '';
for (const line of envContent.split('\n')) {
  if (line.startsWith('DATABASE_URL=')) {
    dbUrl = line.replace('DATABASE_URL=', '').trim().replace(/^["']|["']$/g, '');
  }
}

async function backup() {
  if (!dbUrl) {
    console.error('DATABASE_URL not found');
    return;
  }
  const sql = neon(dbUrl);
  console.log('Starting emergency backup...');
  
  const users = await sql`SELECT * FROM users;`;
  fs.writeFileSync('scratch/backup_users.json', JSON.stringify(users, null, 2));
  console.log('Users backed up:', users.length);

  const orders = await sql`SELECT * FROM orders;`;
  fs.writeFileSync('scratch/backup_orders.json', JSON.stringify(orders, null, 2));
  console.log('Orders backed up:', orders.length);

  const promocodes = await sql`SELECT * FROM promocodes;`;
  fs.writeFileSync('scratch/backup_promocodes.json', JSON.stringify(promocodes, null, 2));
  console.log('Promocodes backed up:', promocodes.length);

  const settings = await sql`SELECT * FROM system_settings;`;
  fs.writeFileSync('scratch/backup_settings.json', JSON.stringify(settings, null, 2));
  console.log('Settings backed up:', settings.length);

  console.log('ALL CRITICAL DATA BACKED UP SUCCESSFULLY!');
}

backup().catch(console.error);
