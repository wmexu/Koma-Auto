import { initializeApp, getApps, cert } from 'firebase-admin/app';
import { getAuth, Auth, UserRecord } from 'firebase-admin/auth';

let isInitialized = false;

/**
 * Initializes and returns Firebase Admin Auth instance if credentials are provided.
 * Supports:
 * 1. FIREBASE_SERVICE_ACCOUNT_KEY (raw JSON string or base64-encoded JSON)
 * 2. FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY + NEXT_PUBLIC_FIREBASE_PROJECT_ID
 * 3. Default Application Credentials (e.g. on GCP/Cloud Run)
 */
export function getFirebaseAdminAuth(): Auth | null {
  if (isInitialized && getApps().length > 0) {
    return getAuth();
  }

  // 1. Raw JSON or Base64 JSON string
  const serviceAccountKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (serviceAccountKey) {
    try {
      let rawJson = serviceAccountKey.trim();
      if (!rawJson.startsWith('{')) {
        rawJson = Buffer.from(rawJson, 'base64').toString('utf8');
      }
      const parsedCert = JSON.parse(rawJson);
      initializeApp({
        credential: cert(parsedCert),
        projectId: parsedCert.project_id || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
      isInitialized = true;
      return getAuth();
    } catch (err) {
      console.warn('[FirebaseAdmin] Failed to initialize from FIREBASE_SERVICE_ACCOUNT_KEY:', err);
    }
  }

  // 2. Individual environment variables
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n');
  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || process.env.FIREBASE_PROJECT_ID;

  if (clientEmail && privateKey && projectId) {
    try {
      initializeApp({
        credential: cert({
          projectId,
          clientEmail,
          privateKey,
        }),
      });
      isInitialized = true;
      return getAuth();
    } catch (err) {
      console.warn('[FirebaseAdmin] Failed to initialize from individual env vars:', err);
    }
  }

  // 3. Fallback: try default application credentials if already running on Google Cloud
  try {
    if (!getApps().length) {
      initializeApp({
        projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      });
      isInitialized = true;
      return getAuth();
    }
  } catch {
    // Expected when running locally or on Vercel without GCP default credentials
  }

  return null;
}

export function isFirebaseAdminConfigured(): boolean {
  return Boolean(
    process.env.FIREBASE_SERVICE_ACCOUNT_KEY ||
    (process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY)
  );
}

export type { UserRecord };
