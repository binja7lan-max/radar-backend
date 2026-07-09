// جسر بين الفرونت → vercel-backend → openwa-service
// يتحقق من هوية المستخدم بـ Firebase ID token، ثم يُحيل إلى openwa-service بمفتاح داخلي
const { getAdmin }   = require('../lib/firebaseAdmin');
const { applyCors }  = require('../lib/cors');
const { verifyAuth } = require('../lib/auth');

// غير إنتاجي = development أو emulator
const IS_NON_PROD = process.env.APP_ENV !== 'production';

const OPENWA_URL = process.env.OPENWA_SERVICE_URL || 'http://localhost:3002';
const OPENWA_KEY = process.env.INTERNAL_API_KEY   || (IS_NON_PROD ? 'radar-local-internal-key' : null);

if (IS_NON_PROD && !process.env.INTERNAL_API_KEY) {
  console.warn('[whatsapp-session] ⚠️  INTERNAL_API_KEY غير محدد — fallback: radar-local-internal-key');
}

async function proxyToOpenwa(path, method, body, action) {
  if (!OPENWA_KEY) {
    throw Object.assign(
      new Error('INTERNAL_API_KEY missing between backend and openwa-service'),
      { internalKeyMissing: true }
    );
  }

  const opts = {
    method,
    headers: { 'x-internal-api-key': OPENWA_KEY },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }

  console.log('[whatsapp-session] forwarding to openwa-service', {
    action: action || method,
    url: `${OPENWA_URL}${path}`,
    hasInternalKey: true,
  });

  let r;
  try {
    r = await fetch(`${OPENWA_URL}${path}`, opts);
  } catch (connErr) {
    throw Object.assign(
      new Error('خدمة واتساب غير شغالة — شغّل openwa-service على المنفذ 3002'),
      { openwaDown: true }
    );
  }

  if (r.status === 401) {
    throw Object.assign(
      new Error('INTERNAL_API_KEY mismatch between backend and openwa-service'),
      { internalKeyMismatch: true }
    );
  }

  const data = await r.json().catch(() => ({}));
  return { status: r.status, data };
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'Method not allowed' });

  let decoded;
  try {
    const admin = getAdmin();
    decoded = await verifyAuth(req, admin);
  } catch (authErr) {
    return res.status(401).json({ error: 'يجب تسجيل الدخول' });
  }

  const uid    = decoded.uid;
  const action = req.body?.action || req.query?.action || '';

  try {
    if (req.method === 'POST' && action === 'start') {
      const { status, data } = await proxyToOpenwa('/session/start', 'POST', { userId: uid }, action);
      return res.status(status).json(data);
    }

    if (req.method === 'GET' && action === 'status') {
      const { status, data } = await proxyToOpenwa(`/session/status?userId=${uid}`, 'GET', undefined, action);
      return res.status(status).json(data);
    }

    if (req.method === 'POST' && action === 'disconnect') {
      const { status, data } = await proxyToOpenwa('/session/disconnect', 'POST', { userId: uid }, action);
      return res.status(status).json(data);
    }

    return res.status(400).json({ error: 'action مطلوب: start | status | disconnect' });

  } catch (e) {
    console.error('[whatsapp-session]', e.message);

    if (e.openwaDown) {
      return res.status(503).json({
        error: 'خدمة واتساب غير شغالة محلياً. شغّل openwa-service على المنفذ 3002',
      });
    }
    if (e.internalKeyMissing || e.internalKeyMismatch) {
      const msg = IS_NON_PROD
        ? e.message
        : 'خطأ في إعداد الخدمة الداخلية';
      return res.status(500).json({ error: msg });
    }

    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
};
