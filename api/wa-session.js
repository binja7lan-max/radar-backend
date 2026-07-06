const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');

const OPENWA_URL = process.env.OPENWA_SERVICE_URL;
const INTERNAL_KEY = process.env.OPENWA_INTERNAL_KEY;

async function verifyToken(req) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) throw new Error('مطلوب تسجيل الدخول');
  const admin = getAdmin();
  const decoded = await admin.auth().verifyIdToken(token);
  return decoded.uid;
}

async function proxyToOpenWA(path, method, body) {
  const res = await fetch(`${OPENWA_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_KEY },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || 'خطأ في خدمة واتساب');
  return data;
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  try {
    const userId = await verifyToken(req);
    const { action } = req.query;
    if (action === 'start' && req.method === 'POST') return res.json(await proxyToOpenWA('/session/start', 'POST', { userId }));
    if (action === 'status' && req.method === 'GET') return res.json(await proxyToOpenWA(`/session/status?userId=${userId}`, 'GET'));
    if (action === 'disconnect' && req.method === 'POST') return res.json(await proxyToOpenWA('/session/disconnect', 'POST', { userId }));
    return res.status(400).json({ error: 'action غير صحيح' });
  } catch (err) {
    return res.status(err.message.includes('تسجيل') ? 401 : 500).json({ error: err.message });
  }
};
