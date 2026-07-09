// تهيئة Firebase Admin SDK مرة واحدة فقط (يُعاد استخدامها بين الاستدعاءات)
//
// APP_ENV = 'development' → Firebase Dev service account (FIREBASE_DEV_SERVICE_ACCOUNT_KEY)
// APP_ENV = 'emulator'    → Firebase Emulator (لا credential)
// APP_ENV = 'production'  → Firebase Production service account (FIREBASE_SERVICE_ACCOUNT_KEY)
//
// server.js يضبط env vars قبل أي require لهذا الملف
const admin = require('firebase-admin');

function getAdmin() {
  if (!admin.apps.length) {
    const APP_ENV = process.env.APP_ENV || 'development';

    if (APP_ENV === 'development') {
      const devKey = process.env.FIREBASE_DEV_SERVICE_ACCOUNT_KEY;
      if (!devKey) {
        console.error('[firebaseAdmin] ❌ FIREBASE_DEV_SERVICE_ACCOUNT_KEY مطلوب لـ APP_ENV=development');
        process.exit(1);
      }
      if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
        console.error('[firebaseAdmin] ❌ FIREBASE_SERVICE_ACCOUNT_KEY وُجد في dev mode — خطر خلط prod/dev، توقف فوري');
        process.exit(1);
      }
      const parsed = JSON.parse(devKey);
      if (parsed.project_id !== 'radar-dev-7387b') {
        console.error(`[firebaseAdmin] ❌ project_id=${parsed.project_id} — المتوقع: radar-dev-7387b`);
        process.exit(1);
      }
      console.log('[firebaseAdmin] DEV online mode: radar-dev-7387b');
      admin.initializeApp({ credential: admin.credential.cert(parsed) });

    } else if (APP_ENV === 'emulator') {
      const project = process.env.GCLOUD_PROJECT || 'radarparts-5d6f0';
      console.log('[firebaseAdmin] EMULATOR mode', {
        auth:      process.env.FIREBASE_AUTH_EMULATOR_HOST,
        firestore: process.env.FIRESTORE_EMULATOR_HOST,
        project,
      });
      // لا credential — firebase-admin v12 يتجاوز فحص الـ credential في emulator mode
      admin.initializeApp({ projectId: project });

    } else if (APP_ENV === 'production') {
      const prodKey = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
      if (!prodKey) {
        console.error('[firebaseAdmin] ❌ FIREBASE_SERVICE_ACCOUNT_KEY مطلوب لـ APP_ENV=production');
        process.exit(1);
      }
      const parsed = JSON.parse(prodKey);
      if (parsed.project_id !== 'radarparts-5d6f0') {
        console.error(`[firebaseAdmin] ❌ project_id=${parsed.project_id} — المتوقع: radarparts-5d6f0`);
        process.exit(1);
      }
      console.log('[firebaseAdmin] PRODUCTION mode');
      admin.initializeApp({ credential: admin.credential.cert(parsed) });

    } else {
      console.error(`[firebaseAdmin] ❌ APP_ENV غير صالح: "${APP_ENV}" — القيم المقبولة: development | emulator | production`);
      process.exit(1);
    }
  }
  return admin;
}

module.exports = { getAdmin };
