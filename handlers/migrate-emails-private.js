const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { verifySuperAdmin } = require('../lib/auth');

// ─── ترحيل لمرة واحدة: نسخ البريد الإلكتروني من مستند المستخدم العام إلى users/{uid}/private/contact،
// ثم حذفه من المستند العام — يغلق ثغرة جمع كل الإيميلات بالجملة عبر القراءة العلنية المباشرة.
// يُستدعى مرة واحدة فقط من سوبر أدمن بعد التأكد أن التسجيل/الدخول/الإشعارات تعمل بالنسخة الجديدة.
// آمن لإعادة التشغيل (idempotent) — يتخطى أي مستخدم بريده محذوف مسبقاً من المستند العام.
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    try { await verifySuperAdmin(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

    const db = admin.firestore();
    const usersSnap = await db.collection('users').get();

    let migrated = 0, skipped = 0;
    for (const userDoc of usersSnap.docs) {
      const data = userDoc.data();
      if (!data.email) { skipped++; continue; }
      await db.collection('users').doc(userDoc.id).collection('private').doc('contact').set({ email: data.email }, { merge: true });
      await db.collection('users').doc(userDoc.id).update({ email: admin.firestore.FieldValue.delete() });
      migrated++;
    }

    return res.status(200).json({ success: true, migrated, skipped, total: usersSnap.size });
  } catch (e) {
    console.error('migrate-emails-private error:', e);
    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
};
