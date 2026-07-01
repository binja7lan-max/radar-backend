const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');

// Rate limiter: حد أقصى 5 طلبات / دقيقة لكل IP
const _rl = new Map();
function isRateLimited(ip) {
  const now = Date.now();
  const e = _rl.get(ip);
  if (!e || now - e.t > 60_000) { _rl.set(ip, { t: now, n: 1 }); return false; }
  if (e.n >= 5) return true;
  e.n++;
  return false;
}

// ─── تحويل رقم جوال إلى البريد المرتبط به (لتسجيل الدخول برقم الجوال) ───
// بدون تسجيل دخول مسبق عمداً (المستخدم لم يدخل بعد) — لكن لا يكشف إلا بريد رقم جوال محدد
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please wait a minute.' });
  }

  try {
    const admin = getAdmin();
    const { phone } = req.body || {};
    if (!phone) return res.status(400).json({ error: 'رقم الجوال مطلوب' });

    const db = admin.firestore();
    const snap = await db.collection('users').where('phone', '==', phone).limit(1).get();
    // نرجّع دائماً 200 لمنع enumeration attack (معرفة هل رقم جوال مسجّل أم لا)
    if (snap.empty) return res.status(200).json({ email: null });

    const uid = snap.docs[0].id;
    let email = snap.docs[0].data().email || null;
    if (!email) {
      const privateSnap = await db.collection('users').doc(uid).collection('private').doc('contact').get();
      email = privateSnap.exists ? privateSnap.data().email : null;
    }
    return res.status(200).json({ email });
  } catch (e) {
    console.error('lookup-email-by-phone error:', e);
    return res.status(500).json({ error: e.message });
  }
};
