const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');

// ─── إضافة إصدار لسجل التحديثات (لوحة الأدمن) — يُستخدم وقت النشر، لا يحتاج تسجيل دخول متصفح ───
// محمي بمفتاح سري (ADMIN_TOOLS_SECRET) بدل توكن مستخدم، لأن هذا الـ endpoint يُستدعى مباشرة من سطر الأوامر وقت الرفع
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const secret = req.headers['x-admin-secret'];
    if (!secret || secret !== process.env.ADMIN_TOOLS_SECRET) {
      return res.status(401).json({ error: 'غير مخوّل' });
    }

    const { version, date, items } = req.body || {};
    if (!version || !Array.isArray(items) || !items.length) {
      return res.status(400).json({ error: 'بيانات غير مكتملة' });
    }

    const admin = getAdmin();
    const db = admin.firestore();
    const docRef = await db.collection('changelog').add({
      version: String(version),
      date: date ? String(date) : '',
      items: items.map(String),
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ success: true, id: docRef.id });
  } catch (e) {
    console.error('add-changelog-entry error:', e);
    return res.status(500).json({ error: e.message });
  }
};
