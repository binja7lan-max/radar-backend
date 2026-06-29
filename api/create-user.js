const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');

const SUPER_ADMIN_EMAIL = 'binja7lan@gmail.com';

// ─── استيراد مستخدم جديد (سوبر أدمن فقط) — يُنشئ حساب Auth + مستند Firestore ──
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();

    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'يجب تسجيل الدخول' });

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (e) {
      return res.status(401).json({ error: 'جلسة غير صالحة، سجّل الدخول مجدداً' });
    }
    if (decoded.email !== SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'سوبر أدمن فقط يمكنه استيراد مستخدمين' });
    }

    let { email, password, name, phone, city, isDealer, dealerBrands, verified } = req.body || {};
    if (!email || !password || !name) {
      return res.status(400).json({ error: 'البريد، كلمة المرور، والاسم مطلوبة' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'كلمة المرور يجب أن تكون 6 أحرف على الأقل' });
    }

    // تطبيع رقم الجوال: إزالة أي رموز/مسافات، وإضافة الصفر الأول تلقائياً إذا أُدخل بدونه
    if (phone) {
      phone = String(phone).replace(/\D/g, '');
      if (/^5\d{8}$/.test(phone)) phone = '0' + phone;
      if (!/^05\d{8}$/.test(phone)) {
        return res.status(400).json({ error: 'رقم الجوال غير صحيح — يجب أن يكون 10 خانات ويبدأ بـ 05' });
      }
      const dupPhone = await admin.firestore().collection('users').where('phone', '==', phone).limit(1).get();
      if (!dupPhone.empty) {
        return res.status(409).json({ error: 'رقم الجوال مستخدم مسبقاً' });
      }
    }

    let userRecord;
    try {
      userRecord = await admin.auth().createUser({ email, password, displayName: name });
    } catch (e) {
      if (e.code === 'auth/email-already-exists') {
        return res.status(409).json({ error: 'هذا البريد مستخدم مسبقاً' });
      }
      throw e;
    }

    const db = admin.firestore();
    await db.collection('users').doc(userRecord.uid).set({
      name,
      phone: phone || '',
      city: city || 'الرياض',
      isDealer: !!isDealer,
      dealerBrands: Array.isArray(dealerBrands) ? dealerBrands : [],
      verified: !!verified,
      banned: false,
      ratingAvg: 0, ratingCount: 0,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    // البريد الإلكتروني يُخزَّن في مستند خاص غير مقروء علناً (يمنع جمعه بالجملة من خارج الموقع)
    await db.collection('users').doc(userRecord.uid).collection('private').doc('contact').set({ email });

    return res.status(200).json({ uid: userRecord.uid, success: true });
  } catch (e) {
    console.error('create-user error:', e);
    return res.status(500).json({ error: e.message });
  }
};
