const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');

const IS_NON_PROD  = process.env.APP_ENV !== 'production';
const OPENWA_URL   = process.env.OPENWA_SERVICE_URL || 'http://localhost:3002';
const INTERNAL_KEY = process.env.INTERNAL_API_KEY   || (IS_NON_PROD ? 'radar-local-internal-key' : null);

async function verifyToken(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) throw new Error('مطلوب تسجيل الدخول');
  const admin = getAdmin();
  const decoded = await admin.auth().verifyIdToken(token);
  return decoded.uid;
}

async function proxyToOpenWA(path, method, body) {
  const opts = {
    method,
    headers: { 'x-internal-api-key': INTERNAL_KEY },
  };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  let r;
  try {
    r = await fetch(`${OPENWA_URL}${path}`, opts);
  } catch (connErr) {
    throw Object.assign(
      new Error(IS_NON_PROD
        ? 'openwa-service غير شغالة — شغّل openwa-service على المنفذ 3002'
        : 'خدمة واتساب غير متاحة حالياً'),
      { serviceDown: true }
    );
  }
  if (r.status === 401) throw new Error('INTERNAL_API_KEY mismatch بين backend و openwa-service');
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'خطأ في خدمة واتساب');
  return data;
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;

  try {
    const userId = await verifyToken(req);
    const action = req.query?.action || req.body?.action || '';

    if (action === 'start' && req.method === 'POST') {
      const result = await proxyToOpenWA('/session/start', 'POST', { userId });
      return res.json(result);
    }

    if (action === 'status' && req.method === 'GET') {
      const result = await proxyToOpenWA(`/session/status?userId=${userId}`, 'GET');
      return res.json(result);
    }

    if (action === 'disconnect' && req.method === 'POST') {
      const result = await proxyToOpenWA('/session/disconnect', 'POST', { userId });
      return res.json(result);
    }

    return res.status(400).json({ error: 'action مطلوب: start | status | disconnect' });
  } catch (err) {
    console.error('[wa-session]', err.message);
    if (err.serviceDown) return res.status(503).json({ error: err.message });
    if (err.message.includes('تسجيل')) return res.status(401).json({ error: err.message });
    return res.status(500).json({ error: err.message });
  }
};
