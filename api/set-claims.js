const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');

const SUPER_ADMIN_UID = 'laNUAfdtndMgGJ65IX1hWVd3UKp2';

// ─── تعيين Custom Claims لحساب السوبر أدمن (يُستدعى مرة واحدة عند الإعداد) ───
// محمي بـ ADMIN_TOOLS_SECRET فقط — لا يحتاج JWT
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const secret = req.headers['x-admin-secret'] || req.body?.secret;
  const expectedSecret = process.env.ADMIN_TOOLS_SECRET;
  if (!expectedSecret || secret !== expectedSecret) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const admin = getAdmin();
    await admin.auth().setCustomUserClaims(SUPER_ADMIN_UID, { superAdmin: true });
    // إجبار تحديث التوكن — يُلغي التخزين المؤقت في Firebase
    await admin.auth().revokeRefreshTokens(SUPER_ADMIN_UID);
    return res.status(200).json({ success: true, message: 'Custom claims set. Please sign out and sign in again.' });
  } catch (e) {
    console.error('set-claims error:', e);
    return res.status(500).json({ error: e.message });
  }
};
