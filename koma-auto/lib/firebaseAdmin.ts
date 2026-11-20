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
      let raw = typeof envKey === 'string' ? envKey.trim() : envKey;
      // Handle base64 encoding if someone base64-encoded the JSON
      if (typeof raw === 'string' && !raw.startsWith('{') && (raw.startsWith('ey') || raw.startsWith('ew'))) {
        try {
          raw = Buffer.from(raw, 'base64').toString('utf8');
        } catch {}
      }
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && typeof parsed.private_key === 'string') {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return parsed;
    } catch (e) {
      console.error('[FirebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY from env:', e);
    }
  }

  // 2. Local File Fallback (Development)
  try {
    const localFile = path.resolve(process.cwd(), 'koma-kz-3d27cf66c894.json');
    if (fs.existsSync(localFile)) {
      const parsed = JSON.parse(fs.readFileSync(localFile, 'utf8'));
      if (parsed && typeof parsed.private_key === 'string') {
        parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
      }
      return parsed;
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
    console.warn('[FirebaseAdmin] Warning: FIREBASE_SERVICE_ACCOUNT_KEY is missing or invalid.');
    return null;
  }

  try {
    return initializeApp({
      credential: cert(credentials),
    });
  } catch (err) {
    console.error('[FirebaseAdmin] initializeApp error:', err);
    return null;
  }
}

// Lazy safe proxy so Next.js build never crashes if env var is temporarily missing during static analysis
export const adminAuth = new Proxy({} as ReturnType<typeof getAuth>, {
  get(_target, prop) {
    const app = initAdminApp();
    if (!app) {
      throw new Error(
        'Firebase Admin SDK не настроен на сервере Vercel. Добавьте переменную FIREBASE_SERVICE_ACCOUNT_KEY и обязательно сделайте Redeploy проекта.'
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
