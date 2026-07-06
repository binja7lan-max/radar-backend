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
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    await verifyToken(req);
    const { jobId } = req.query;
    if (!jobId) return res.status(400).json({ error: 'jobId مطلوب' });
    const response = await fetch(`${OPENWA_URL}/send/send-job/${jobId}`, {
      headers: { 'x-internal-key': INTERNAL_KEY },
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'خطأ في الجلب');
    return res.json(data);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
