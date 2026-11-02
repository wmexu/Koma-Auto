import { NextResponse } from 'next/server';
import { client, isDbConfigured } from '@/db';
import { verifyStaffSession } from '@/lib/admin-auth';
import { getFirebaseAdminAuth, isFirebaseAdminConfigured, UserRecord } from '@/lib/firebase-admin';
import { initializeApp, getApps, deleteApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import fs from 'fs';
import path from 'path';

export async function GET(request: Request) {
  try {
    const auth = await verifyStaffSession(request, ['director', 'manager']);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    const configured = isFirebaseAdminConfigured() || getApps().length > 0;
    return NextResponse.json({
      success: true,
      configured,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || 'koma-kz',
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || 'Ошибка проверки статуса' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    // Only Director can trigger full Firebase Auth synchronization
    const auth = await verifyStaffSession(request, ['director']);
    if (!auth.authorized) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }

    if (!isDbConfigured() || !client) {
      return NextResponse.json({ error: 'База данных недоступна' }, { status: 503 });
    }

    let body: any = {};
    try {
      body = await request.json();
    } catch {
      // Empty body is valid if using env credentials
    }

    let fbAdmin = getFirebaseAdminAuth();

    // If director provided service account JSON in request body, initialize or re-initialize
    if (body.serviceAccountJson && typeof body.serviceAccountJson === 'string') {
      try {
        let raw = body.serviceAccountJson.trim();
        if (!raw.startsWith('{')) {
          raw = Buffer.from(raw, 'base64').toString('utf8');
        }
        const parsedCert = JSON.parse(raw);
        if (!parsedCert.client_email || !parsedCert.private_key) {
          return NextResponse.json({ error: 'Некорректный JSON сервисного аккаунта: отсутствуют client_email или private_key' }, { status: 400 });
        }

        // Clean existing apps
        const existingApps = getApps();
        if (existingApps.length > 0) {
          await Promise.all(existingApps.map(app => deleteApp(app)));
        }

        initializeApp({
          credential: cert(parsedCert),
          projectId: parsedCert.project_id || process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
        });
        fbAdmin = getAuth();

        // Safely persist to .env.local on the server so it persists across restarts
        try {
          const envPath = path.join(process.cwd(), '.env.local');
          if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8');
            const cleanJsonOneLine = JSON.stringify(parsedCert);
            if (envContent.includes('FIREBASE_SERVICE_ACCOUNT_KEY=')) {
              envContent = envContent.replace(/FIREBASE_SERVICE_ACCOUNT_KEY=.*(\r?\n|$)/, `FIREBASE_SERVICE_ACCOUNT_KEY='${cleanJsonOneLine}'$1`);
            } else {
              envContent += `\nFIREBASE_SERVICE_ACCOUNT_KEY='${cleanJsonOneLine}'\n`;
            }
            fs.writeFileSync(envPath, envContent, 'utf8');
            process.env.FIREBASE_SERVICE_ACCOUNT_KEY = cleanJsonOneLine;
          }
        } catch (saveErr) {
          console.warn('[FirebaseSync] Could not auto-save to .env.local:', saveErr);
        }
      } catch (parseErr: any) {
        return NextResponse.json({ error: `Ошибка парсинга JSON: ${parseErr.message}` }, { status: 400 });
      }
    }

    if (!fbAdmin) {
      return NextResponse.json({
        error: 'Firebase Admin не настроен. Передайте serviceAccountJson или укажите FIREBASE_SERVICE_ACCOUNT_KEY в .env.local',
        requiresServiceAccount: true,
      }, { status: 400 });
    }

    // Fetch all users directly from Firebase Authentication
    let nextPageToken: string | undefined = undefined;
    const allUsers: UserRecord[] = [];

    do {
      const listResult: { users: UserRecord[]; pageToken?: string } = await fbAdmin.listUsers(1000, nextPageToken);
      allUsers.push(...listResult.users);
      nextPageToken = listResult.pageToken;
    } while (nextPageToken);

    let syncedCount = 0;

    for (const fbUser of allUsers) {
      if (!fbUser.email) continue;
      const cleanEmail = fbUser.email.trim().toLowerCase();
      const cleanName = fbUser.displayName && !fbUser.displayName.includes('@') ? fbUser.displayName.trim() : null;
      const cleanPhone = fbUser.phoneNumber ? fbUser.phoneNumber.trim() : null;
      const createdAt = fbUser.metadata.creationTime ? new Date(fbUser.metadata.creationTime) : new Date();

      // Check if user already exists to protect elevated staff roles (director, manager, courier, wholesale)
      const existing = await client`
        SELECT id, role, full_name, phone FROM users WHERE id = ${fbUser.uid} OR LOWER(email) = ${cleanEmail} LIMIT 1;
      `;

      if (existing && existing.length > 0) {
        const currentRole = existing[0].role;
        const isElevated = ['director', 'manager', 'courier', 'wholesale'].includes(currentRole);
        const finalRole = isElevated ? currentRole : 'customer';
        const finalName = existing[0].full_name && existing[0].full_name !== 'Покупатель'
          ? existing[0].full_name
          : (cleanName || existing[0].full_name);
        const finalPhone = cleanPhone || existing[0].phone;

        await client`
          UPDATE users
          SET
            id = ${fbUser.uid},
            email = ${cleanEmail},
            full_name = ${finalName},
            phone = ${finalPhone},
            role = ${finalRole},
            updated_at = NOW()
          WHERE id = ${fbUser.uid} OR LOWER(email) = ${cleanEmail};
        `;
      } else {
        await client`
          INSERT INTO users (id, email, full_name, phone, role, is_blocked, failed_code_attempts, created_at, updated_at)
          VALUES (
            ${fbUser.uid},
            ${cleanEmail},
            ${cleanName},
            ${cleanPhone},
            'customer',
            false,
            0,
            ${createdAt},
            NOW()
          )
          ON CONFLICT (id) DO UPDATE SET
            email = EXCLUDED.email,
            full_name = COALESCE(NULLIF(EXCLUDED.full_name, 'Покупатель'), users.full_name),
            phone = COALESCE(EXCLUDED.phone, users.phone),
            updated_at = NOW();
        `;
      }

      syncedCount++;
    }

    return NextResponse.json({
      success: true,
      totalFound: allUsers.length,
      syncedCount,
      message: `Успешно синхронизировано ${syncedCount} пользователей из Firebase Authentication`,
    });
  } catch (error: any) {
    console.error('[FirebaseSync Error]:', error);
    return NextResponse.json({ error: error?.message || 'Ошибка синхронизации' }, { status: 500 });
  }
}
