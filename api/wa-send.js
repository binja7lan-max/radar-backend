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

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const userId = await verifyToken(req);
    const { requestId, merchantIds, messageTemplate } = req.body || {};
    if (!requestId || !Array.isArray(merchantIds) || !merchantIds.length)
      return res.status(400).json({ error: 'requestId و merchantIds مطلوبان' });
    const response = await fetch(`${OPENWA_URL}/send/send-job`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-key': INTERNAL_KEY },
      body: JSON.stringify({ userId, requestId, merchantIds, messageTemplate }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'خطأ في الإرسال');
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
