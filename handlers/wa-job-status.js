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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  try {
    await verifyToken(req);
    const { jobId } = req.query;
    if (!jobId) return res.status(400).json({ error: 'jobId مطلوب' });

    let response;
    try {
      response = await fetch(`${OPENWA_URL}/send/send-job/${jobId}`, {
        headers: { 'x-internal-api-key': INTERNAL_KEY },
      });
    } catch (connErr) {
      return res.status(503).json({
        error: IS_NON_PROD
          ? 'openwa-service غير شغالة — شغّل openwa-service على المنفذ 3002'
          : 'خدمة واتساب غير متاحة حالياً',
      });
    }

    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'خطأ في جلب حالة الإرسال');
    return res.json(data);
  } catch (err) {
    console.error('[wa-job-status]', err.message);
    return res.status(err.message.includes('تسجيل') ? 401 : 500).json({ error: err.message });
  }
};
