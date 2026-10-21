import dns from 'node:dns';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

// Ensure IPv4 resolution first on environments where IPv6 routing is unsupported
if (typeof dns.setDefaultResultOrder === 'function') {
  try {
    dns.setDefaultResultOrder('ipv4first');
  } catch {
    // Ignore in edge runtime
  }
}

const connectionString = process.env.DATABASE_URL;

// Reusable connection client with pooling for Next.js / Node
export const client = connectionString
  ? postgres(connectionString, {
      max: process.env.NODE_ENV === 'production' ? 10 : 5,
      idle_timeout: 20,
      connect_timeout: 10,
    })
  : null;

export const db = client ? drizzle(client, { schema }) : null;

export function isDbConfigured(): boolean {
  return Boolean(process.env.DATABASE_URL);
}

export { schema };
