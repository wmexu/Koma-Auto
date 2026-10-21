import '../db/index.ts';
import postgres from 'postgres';

async function main() {
  const url = process.env.DATABASE_URL;
  console.log('Testing connection to Neon Lakebase Postgres through db config...');
  const sql = postgres(url, { max: 1, idle_timeout: 5 });
  try {
    const [result] = await sql`SELECT version(), current_database(), current_user, now();`;
    console.log('Direct connection succeeded without external flags!');
    console.log('Postgres Version:', result.version);
    console.log('Database Name:', result.current_database);
    console.log('Connected User:', result.current_user);
  } catch (err) {
    console.error('Connection failed:', err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

main();
