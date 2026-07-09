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

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const userId = await verifyToken(req);
    const { requestId, merchantIds, messageTemplate } = req.body || {};

    if (!requestId || !Array.isArray(merchantIds) || !merchantIds.length) {
      return res.status(400).json({ error: 'requestId و merchantIds مطلوبان' });
    }

    let response;
    try {
      response = await fetch(`${OPENWA_URL}/send/send-job`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-internal-api-key': INTERNAL_KEY,
        },
        body: JSON.stringify({ userId, requestId, merchantIds, messageTemplate }),
      });
    } catch (connErr) {
      return res.status(503).json({
        error: IS_NON_PROD
          ? 'openwa-service غير شغالة — شغّل openwa-service على المنفذ 3002'
          : 'خدمة واتساب غير متاحة حالياً',
      });
    }

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'خطأ في الإرسال');
    return res.json(data);
  } catch (err) {
    console.error('[wa-send]', err.message);
    return res.status(err.message.includes('تسجيل') ? 401 : 500).json({ error: err.message });
  }
};
