const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');

// حد: 10 طلبات كل 60 ثانية لكل IP
const RATE_LIMIT = 10;
const WINDOW_MS = 60 * 1000;

async function checkRateLimit(db, ip) {
  const key = 'phone_lookup_' + ip.replace(/[.:]/g, '_');
  const ref = db.collection('rateLimits').doc(key);
  const snap = await ref.get();
  const now = Date.now();
  if (snap.exists) {
    const { count, windowStart } = snap.data();
    if (now - windowStart < WINDOW_MS) {
      if (count >= RATE_LIMIT) return false;
      await ref.update({ count: count + 1 });
    } else {
      await ref.set({ count: 1, windowStart: now });
    }
  } else {
    await ref.set({ count: 1, windowStart: now });
  }
  return true;
}

// ─── تحويل رقم جوال إلى البريد المرتبط به (لتسجيل الدخول برقم الجوال) ───
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    const db = admin.firestore();
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'رقم الجوال مطلوب' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
    let allowed = true;
    try { allowed = await checkRateLimit(db, ip); } catch (_) {}
    if (!allowed) return res.status(429).json({ error: 'محاولات كثيرة، انتظر دقيقة ثم أعد المحاولة' });

    const phoneIndexSnap = await db.collection('phoneIndex').doc(phone).get();

    let uid;
    if (phoneIndexSnap.exists) {
      uid = phoneIndexSnap.data().uid;
    } else {
      // fallback للمستخدمين القدامى الذين جوالهم مخزّن في المستند العام users
      const usersSnap = await db.collection('users').where('phone', '==', phone).limit(1).get();
      if (usersSnap.empty) return res.status(200).json({ email: null });
      uid = usersSnap.docs[0].id;
    }

    try {
      const userRecord = await admin.auth().getUser(uid);
      return res.status(200).json({ email: userRecord.email || null });
    } catch (_) {
      return res.status(200).json({ email: null });
    }
  } catch (e) {
    console.error('lookup-email-by-phone error:', e);
    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
};
