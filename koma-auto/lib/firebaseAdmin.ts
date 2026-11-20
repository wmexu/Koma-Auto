import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

interface ServiceAccountConfig {
  client_email: string;
  private_key: string;
  project_id: string;
}

let cachedAccessToken: { token: string; expiresAt: number } | null = null;

/**
 * Safely parses the service account configuration from Vercel ENV or local fallback file
 */
export function getServiceAccountConfig(): ServiceAccountConfig | null {
  // 1. Production / Vercel Environment Variable
  const envKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (envKey) {
    try {
      let raw = typeof envKey === 'string' ? envKey.trim() : envKey;
      // Handle base64 encoded strings
      if (typeof raw === 'string' && !raw.startsWith('{') && (raw.startsWith('ey') || raw.startsWith('ew'))) {
        try {
          raw = Buffer.from(raw, 'base64').toString('utf8');
        } catch {}
      }
      const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
      if (parsed && parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, '\n'),
          project_id: parsed.project_id || 'koma-kz',
        };
      }
    } catch (e) {
      console.error('[FirebaseAdmin] Failed to parse FIREBASE_SERVICE_ACCOUNT_KEY from env:', e);
    }
  }

  // 2. Local File Fallback (Development)
  try {
    const localFile = path.resolve(process.cwd(), 'koma-kz-3d27cf66c894.json');
    if (fs.existsSync(localFile)) {
      const parsed = JSON.parse(fs.readFileSync(localFile, 'utf8'));
      if (parsed && parsed.client_email && parsed.private_key) {
        return {
          client_email: parsed.client_email,
          private_key: parsed.private_key.replace(/\\n/g, '\n'),
          project_id: parsed.project_id || 'koma-kz',
        };
      }
    }
  } catch (err) {
    console.warn('[FirebaseAdmin] Could not read local service account file:', err);
  }

  return null;
}

/**
 * Obtains a fresh Google OAuth2 access token for the service account (cached for 50 mins)
 * Uses native Node.js crypto + fetch: zero external packages, 100% reliable on Vercel
 */
export async function getGoogleOAuth2AccessToken(): Promise<string | null> {
  if (cachedAccessToken && cachedAccessToken.expiresAt > Date.now()) {
    return cachedAccessToken.token;
  }

  const sa = getServiceAccountConfig();
  if (!sa) {
    console.warn('[FirebaseAdmin] Service account credentials not found in env or file.');
    return null;
  }

  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(
    JSON.stringify({
      iss: sa.client_email,
      scope: 'https://www.googleapis.com/auth/identitytoolkit',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  ).toString('base64url');

  const signer = crypto.createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(sa.private_key, 'base64url');
  const assertion = `${header}.${payload}.${signature}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    }),
  });

  if (!res.ok) {
    const errorText = await res.text();
    console.error('[FirebaseAdmin] OAuth2 token exchange failed:', res.status, errorText);
    return null;
  }

  const data = (await res.json()) as { access_token?: string; expires_in?: number };
  if (!data.access_token) {
    console.error('[FirebaseAdmin] No access_token returned by Google OAuth2');
    return null;
  }

  cachedAccessToken = {
    token: data.access_token,
    expiresAt: Date.now() + ((data.expires_in || 3600) - 300) * 1000,
  };

  return data.access_token;
}

/**
 * Deletes a user by Firebase UID using Google Identity Platform REST API
 */
export async function deleteFirebaseUser(uid: string): Promise<{ success: boolean; notFound?: boolean; error?: string }> {
  try {
    const token = await getGoogleOAuth2AccessToken();
    if (!token) {
      return {
        success: false,
        error: 'Сервисный ключ Firebase не настроен на сервере Vercel (FIREBASE_SERVICE_ACCOUNT_KEY)',
      };
    }

    const sa = getServiceAccountConfig();
    const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:delete', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        localId: uid,
        targetProjectId: sa?.project_id || 'koma-kz',
      }),
    });

    if (res.ok) {
      return { success: true };
    }

    const errData = (await res.json().catch(() => ({}))) as any;
    const msg = errData?.error?.message || '';

    // USER_NOT_FOUND means user is already deleted or never existed in Firebase Auth
    if (msg === 'USER_NOT_FOUND') {
      return { success: true, notFound: true };
    }

    return {
      success: false,
      error: `Google Identity API error (${res.status}): ${msg || res.statusText}`,
    };
  } catch (err: any) {
    console.error('[FirebaseAdmin] deleteFirebaseUser error:', err);
    return { success: false, error: err?.message || 'Network error deleting Firebase user' };
  }
}

/**
 * Looks up a Firebase user by UID
 */
export async function getFirebaseUser(uid: string): Promise<{ uid: string; email?: string } | null> {
  try {
    const token = await getGoogleOAuth2AccessToken();
    if (!token) return null;

    const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ localId: [uid] }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const user = data.users?.[0];
    if (user?.localId) {
      return { uid: user.localId, email: user.email };
    }
    return null;
  } catch (err) {
    console.error('[FirebaseAdmin] getFirebaseUser error:', err);
    return null;
  }
}

/**
 * Looks up a Firebase user by Email
 */
export async function getFirebaseUserByEmail(email: string): Promise<{ uid: string; email?: string } | null> {
  try {
    const token = await getGoogleOAuth2AccessToken();
    if (!token) return null;

    const res = await fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email: [email.toLowerCase().trim()] }),
    });

    if (!res.ok) return null;
    const data = (await res.json()) as any;
    const user = data.users?.[0];
    if (user?.localId) {
      return { uid: user.localId, email: user.email };
    }
    return null;
  } catch (err) {
    console.error('[FirebaseAdmin] getFirebaseUserByEmail error:', err);
    return null;
  }
}

/**
 * Lists accounts from Firebase Auth (up to maxResults)
 */
export async function listFirebaseUsers(maxResults = 1000): Promise<Array<{ uid: string; email?: string; creationTime?: string }>> {
  try {
    const token = await getGoogleOAuth2AccessToken();
    if (!token) return [];

    const sa = getServiceAccountConfig();
    const res = await fetch(
      `https://identitytoolkit.googleapis.com/v1/projects/${sa?.project_id || 'koma-kz'}/accounts:batchGet?maxResults=${maxResults}`,
      {
        headers: { Authorization: `Bearer ${token}` },
      }
    );

    if (!res.ok) return [];
    const data = (await res.json()) as any;
    if (Array.isArray(data.users)) {
      return data.users.map((u: any) => ({
        uid: u.localId,
        email: u.email,
        creationTime: u.createdAt ? new Date(Number(u.createdAt)).toISOString() : undefined,
      }));
    }
    return [];
  } catch (err) {
    console.error('[FirebaseAdmin] listFirebaseUsers error:', err);
    return [];
  }
}

/**
 * Backward compatibility wrapper matching firebase-admin Auth interface
 */
export const adminAuth = {
  async deleteUser(uid: string) {
    const res = await deleteFirebaseUser(uid);
    if (!res.success && !res.notFound) {
      const err = new Error(res.error || 'Failed to delete user');
      (err as any).code = 'auth/unknown-error';
      throw err;
    }
  },
  async getUser(uid: string) {
    const user = await getFirebaseUser(uid);
    if (!user) {
      const err = new Error('User not found');
      (err as any).code = 'auth/user-not-found';
      throw err;
    }
    return user;
  },
  async getUserByEmail(email: string) {
    const user = await getFirebaseUserByEmail(email);
    if (!user) {
      const err = new Error('User not found');
      (err as any).code = 'auth/user-not-found';
      throw err;
    }
    return user;
  },
  async listUsers(maxResults = 1000) {
    const users = await listFirebaseUsers(maxResults);
    return {
      users: users.map(u => ({
        uid: u.uid,
        email: u.email,
        metadata: { creationTime: u.creationTime, lastSignInTime: undefined },
      })),
    };
  },
};
