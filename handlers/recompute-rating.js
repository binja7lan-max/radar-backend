const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { verifyAuth } = require('../lib/auth');

// ─── إعادة حساب متوسط/عدد التقييمات من واقع مستندات ratings الفعلية وكتابتها عبر Admin SDK ───
// القاعدة لا تسمح للمستخدم بكتابة ratingAvg/ratingCount على نفسه (يمنع تزييف التقييم من المتصفح)،
// لذا هذا المسار يحسب القيمة من الخادم نفسه ولا يقبل أي قيمة جاهزة من الطالب.
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    let decoded;
    try { decoded = await verifyAuth(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

    const { ratedId } = req.body || {};
    if (!ratedId) return res.status(400).json({ error: 'ratedId مطلوب' });

    const db = admin.firestore();

    // حد: مرة واحدة كل دقيقتين لكل (caller, ratedId) لمنع استدعاء متكرر كـ DoS مالي
    const rlKey = `recompute_${decoded.uid}_${ratedId}`;
    const rlRef = db.collection('rateLimits').doc(rlKey);
    const rlSnap = await rlRef.get();
    const now = Date.now();
    if (rlSnap.exists && (now - rlSnap.data().lastAt) < 2 * 60 * 1000) {
      return res.status(429).json({ error: 'حاول مرة أخرى بعد قليل' });
    }
    await rlRef.set({ lastAt: now });
    const snap = await db.collection('ratings').where('ratedId', '==', ratedId).get();
    const scores = snap.docs.filter(d => !d.data().hidden).map(d => d.data().score || 0);
    const ratingCount = scores.length;
    const ratingAvg = ratingCount ? scores.reduce((s, v) => s + v, 0) / ratingCount : 0;

    await db.collection('users').doc(ratedId).set({ ratingAvg, ratingCount }, { merge: true });

    return res.status(200).json({ ratingAvg, ratingCount });
  } catch (e) {
    console.error('recompute-rating error:', e);
    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
};
