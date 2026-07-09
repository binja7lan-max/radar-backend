// ─── Radar — Local/Dev Backend Server ────────────────────────────────────────
// يُشغَّل من مجلد vercel-backend:   node server.js
// يستمع على:                         http://localhost:3001
//
// APP_ENV = 'development' → Firebase Dev Online (افتراضي) — FIREBASE_DEV_SERVICE_ACCOUNT_KEY مطلوب
// APP_ENV = 'emulator'    → Firebase Emulator — لا service account
// APP_ENV = 'production'  → لا تُشغَّل server.js في production (Vercel يُشغَّل handlers مباشرة)

const PORT    = process.env.PORT    || 3001;
const APP_ENV = process.env.APP_ENV || 'development';

// ─── إعداد env vars حسب البيئة قبل أي require لـ firebase-admin ───────────────
if (APP_ENV === 'development') {
  if (!process.env.FIREBASE_DEV_SERVICE_ACCOUNT_KEY) {
    const fs = require('fs');
    const path = require('path');
    const secretsFile = path.join(__dirname, '..', 'secrets', 'dev-service-account.json');
    if (fs.existsSync(secretsFile)) {
      process.env.FIREBASE_DEV_SERVICE_ACCOUNT_KEY = fs.readFileSync(secretsFile, 'utf8');
      console.log('✅ تم تحميل service account من secrets/dev-service-account.json');
    }
  }
  if (!process.env.FIREBASE_DEV_SERVICE_ACCOUNT_KEY) {
    console.error('❌ FIREBASE_DEV_SERVICE_ACCOUNT_KEY مطلوب لـ APP_ENV=development');
    console.error('   ضعه في secrets\\dev-service-account.json ثم شغّل start-local.ps1');
    console.error('   أو: $env:FIREBASE_DEV_SERVICE_ACCOUNT_KEY = Get-Content path\\to\\dev-sa.json -Raw');
    process.exit(1);
  }
  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    console.error('❌ FIREBASE_SERVICE_ACCOUNT_KEY وُجد في dev mode — خطر خلط prod/dev، توقف فوري');
    process.exit(1);
  }
  // حماية: لا emulator hosts في dev
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
  delete process.env.FIRESTORE_EMULATOR_HOST;

} else if (APP_ENV === 'emulator') {
  process.env.FIREBASE_AUTH_EMULATOR_HOST = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
  process.env.FIRESTORE_EMULATOR_HOST     = process.env.FIRESTORE_EMULATOR_HOST     || '127.0.0.1:8080';
  process.env.GCLOUD_PROJECT              = process.env.GCLOUD_PROJECT              || 'radarparts-5d6f0';

  // حماية: تأكد أن الـ hosts محلية فعلاً
  const _safe = (h) => h.startsWith('127.0.0.1') || h.startsWith('localhost');
  if (!_safe(process.env.FIREBASE_AUTH_EMULATOR_HOST) || !_safe(process.env.FIRESTORE_EMULATOR_HOST)) {
    console.error('❌ اكتُشف Emulator host غير محلي — توقف فوري لحماية production');
    process.exit(1);
  }

} else if (APP_ENV === 'production') {
  console.error('⚠️  server.js لا يُستخدم في production — Vercel يُشغَّل handlers مباشرة');
  process.exit(1);

} else {
  console.error(`❌ APP_ENV غير صالح: "${APP_ENV}" — القيم المقبولة: development | emulator`);
  process.exit(1);
}

const http    = require('http');
const { URL } = require('url');

const HANDLERS = {
  // ─── Auth & Users ──────────────────────────────────────────────────────────
  '/api/create-user':               './handlers/create-user',
  '/api/delete-user':               './handlers/delete-user',
  '/api/update-my-phone':           './handlers/update-my-phone',
  '/api/update-user-contact':       './handlers/update-user-contact',
  '/api/set-claims':                './handlers/set-claims',
  '/api/lookup-email-by-phone':     './handlers/lookup-email-by-phone',
  // ─── Email ─────────────────────────────────────────────────────────────────
  '/api/send-email':                './handlers/send-email',
  // ─── Content & Admin ───────────────────────────────────────────────────────
  '/api/moderate-content':          './handlers/moderate-content',
  '/api/extract-vin':               './handlers/extract-vin',
  '/api/add-changelog-entry':       './handlers/add-changelog-entry',
  '/api/request-dealer-candidates': './handlers/request-dealer-candidates',
  '/api/notify-matching-dealers':   './handlers/notify-matching-dealers',
  // ─── Ratings & Payments ────────────────────────────────────────────────────
  '/api/recompute-rating':          './handlers/recompute-rating',
  '/api/record-commission-payment': './handlers/record-commission-payment',
  '/api/paypal-create-order':       './handlers/paypal-create-order',
  '/api/paypal-capture-order':      './handlers/paypal-capture-order',
  // ─── Push Notifications ────────────────────────────────────────────────────
  '/api/send-push':                 './handlers/send-push',
  // ─── WhatsApp (openwa-service proxy) ───────────────────────────────────────
  '/api/whatsapp-session':          './handlers/whatsapp-session',  // old flow + GET /api/whatsapp-session
  '/api/wa-session':                './handlers/wa-session',
  '/api/wa-send':                   './handlers/wa-send',
  '/api/wa-job-status':             './handlers/wa-job-status',
};

function getHandler(pathname) {
  const handlerPath = HANDLERS[pathname];
  return handlerPath ? require(handlerPath) : null;
}

function shimResponse(res) {
  res.status = (code) => { res.statusCode = code; return res; };
  res.json   = (data) => {
    if (!res.headersSent) res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(data));
  };
  return res;
}

const server = http.createServer((req, res) => {
  let rawBody = '';
  req.on('data', chunk => { rawBody += chunk; });
  req.on('end', async () => {
    try { req.body = rawBody ? JSON.parse(rawBody) : {}; } catch { req.body = {}; }
    shimResponse(res);

    const _url = new URL(req.url, `http://localhost:${PORT}`);
    const pathname = _url.pathname;
    req.query = Object.fromEntries(_url.searchParams.entries());
    const handler = getHandler(pathname);
    if (!handler) return res.status(404).json({ error: 'Not found', path: pathname });

    try { await handler(req, res); }
    catch (e) {
      console.error(`[${pathname}]`, e.message);
      if (!res.writableEnded) res.status(500).json({ error: e.message });
    }
  });
});

server.listen(PORT, () => {
  if (APP_ENV === 'development') {
    console.log('\n  🔧  Radar — Dev Backend (Firebase Dev Online)');
    console.log(`      http://localhost:${PORT}`);
    console.log('      Firebase: radar-dev-7387b');
    console.log('      لا يتصل بـ Firebase production\n');
  } else {
    console.log('\n  🛠️  Radar — Emulator Backend');
    console.log(`      http://localhost:${PORT}`);
    console.log(`      Auth Emulator:      ${process.env.FIREBASE_AUTH_EMULATOR_HOST}`);
    console.log(`      Firestore Emulator: ${process.env.FIRESTORE_EMULATOR_HOST}`);
    console.log('      لا يتصل بـ Firebase online\n');
  }
});
