import { initializeApp, getApps, getApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { ServiceAccount } from 'firebase-admin';
import fs from 'node:fs';
import path from 'node:path';

function getServiceAccount(): ServiceAccount | null {
  // 1. Vercel / Production Environment Variable (Secure)
  const envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (envKey) {
    try {
      return typeof envKey === 'string' ? JSON.parse(envKey) : envKey;
    } catch (e) {
      console.error('[FirebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY from env:', e);
    }
  }

  // 2. Local File Fallback (Development)
  try {
    const localFile = path.resolve(process.cwd(), 'koma-kz-3d27cf66c894.json');
    if (fs.existsSync(localFile)) {
      return JSON.parse(fs.readFileSync(localFile, 'utf8'));
    }
  } catch (err) {
    console.warn('[FirebaseAdmin] Could not read local service account file:', err);
  }

  return null;
}

function initAdminApp() {
  if (getApps().length > 0) {
    return getApp();
  }

  const credentials = getServiceAccount();
  if (!credentials) {
    // Return dummy or throw on actual use if missing
    console.warn('[FirebaseAdmin] Warning: FIREBASE_SERVICE_ACCOUNT_KEY is missing.');
    return null;
  }

  return initializeApp({
    credential: cert(credentials),
  });
}

// Lazy safe proxy so Next.js build never crashes if env var is temporarily missing during static analysis
export const adminAuth = new Proxy({} as ReturnType<typeof getAuth>, {
  get(_target, prop) {
    const app = initAdminApp();
    if (!app) {
      throw new Error(
        'Firebase Admin SDK is not configured. Please add FIREBASE_SERVICE_ACCOUNT_KEY to your Vercel Environment Variables.'
      );
    }
    const auth = getAuth(app);
    const value = (auth as any)[prop];
    if (typeof value === 'function') {
      return value.bind(auth);
    }
    return value;
  },
});
