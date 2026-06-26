const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');

// ─── تحويل رقم جوال إلى البريد المرتبط به (لتسجيل الدخول برقم الجوال) ───
// بدون تسجيل دخول مسبق عمداً (المستخدم لم يدخل بعد) — لكن لا يكشف إلا بريد رقم جوال محدد بالضبط
// (وليس قائمة جماعية)، وهو نفس المنطق الذي كان يعمل سابقاً مباشرة من المتصفح عبر Firestore
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'رقم الجوال مطلوب' });

    const db = admin.firestore();
    const snap = await db.collection('users').where('phone', '==', phone).limit(1).get();
    if (snap.empty) return res.status(404).json({ error: 'لا يوجد مستخدم بهذا الرقم' });

    const uid = snap.docs[0].id;
    let email = snap.docs[0].data().email || null;
    if (!email) {
      const privateSnap = await db.collection('users').doc(uid).collection('private').doc('contact').get();
      email = privateSnap.exists ? privateSnap.data().email : null;
    }
    if (!email) return res.status(404).json({ error: 'لا يوجد مستخدم بهذا الرقم' });

    return res.status(200).json({ email });
  } catch (e) {
    console.error('lookup-email-by-phone error:', e);
    return res.status(500).json({ error: e.message });
  }
};
