// ─── Self-service phone update — أي مستخدم مسجّل يُعدّل جواله الخاص ──────────
// يُحدّث: users/{uid}/private/contact + phoneIndex (atomic batch)
// لا يتطلب صلاحيات أدمن — يتحقق فقط أن المستخدم يعدّل رقمه هو
const { getAdmin }           = require('../lib/firebaseAdmin');
const { applyCors }          = require('../lib/cors');
const { normalizeSaudiPhone } = require('../lib/validators');

const IS_EMULATOR = !!(process.env.FIREBASE_AUTH_EMULATOR_HOST);

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    let admin;
    try { admin = getAdmin(); } catch (e) {
      const body = { error: 'حدث خطأ داخلي' };
      if (IS_EMULATOR) body.debug = { stage: 'get-admin', message: e.message };
      return res.status(500).json(body);
    }

    // التحقق من هوية المستخدم — أي مستخدم مسجّل
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'يجب تسجيل الدخول' });

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (e) {
      console.error('[update-my-phone] verify-token:', e.message);
      return res.status(401).json({ error: 'جلسة غير صالحة، سجّل الدخول مجدداً' });
    }

    const uid = decoded.uid;
    const { newPhone } = req.body || {};
    const db = admin.firestore();

    // قراءة الجوال الحالي من private/contact
    let oldPhone = '';
    try {
      const contactSnap = await db.collection('users').doc(uid).collection('private').doc('contact').get();
      oldPhone = (contactSnap.exists ? contactSnap.data().phone : '') || '';
    } catch (_) {}

    // تطبيع الجوال الجديد والتحقق من صحة صيغته
    let cleanPhone = '';
    if (newPhone !== null && newPhone !== undefined && newPhone !== '' && newPhone !== 0) {
      cleanPhone = normalizeSaudiPhone(newPhone);
      if (cleanPhone && !/^05\d{8}$/.test(cleanPhone)) {
        return res.status(400).json({ error: 'رقم الجوال غير صحيح — يجب أن يكون 10 خانات ويبدأ بـ 05 أو 9 خانات ويبدأ بـ 5' });
      }
    }

    // لا تغيير — ردّ بنجاح بلا عمليات كتابة
    if (cleanPhone === oldPhone) {
      return res.status(200).json({ success: true, phone: cleanPhone });
    }

    // التحقق من تكرار الجوال عبر phoneIndex
    if (cleanPhone) {
      const dupSnap = await db.collection('phoneIndex').doc(cleanPhone).get();
      if (dupSnap.exists && dupSnap.data().uid !== uid) {
        return res.status(409).json({ error: 'رقم الجوال مستخدم مسبقاً بحساب آخر' });
      }
    }

    // Atomic batch: private/contact + phoneIndex
    const batch = db.batch();
    batch.set(
      db.collection('users').doc(uid).collection('private').doc('contact'),
      { phone: cleanPhone },
      { merge: true }
    );
    if (oldPhone && oldPhone !== cleanPhone) {
      batch.delete(db.collection('phoneIndex').doc(oldPhone));
    }
    if (cleanPhone) {
      batch.set(db.collection('phoneIndex').doc(cleanPhone), { uid });
    }
    await batch.commit();

    if (IS_EMULATOR) console.log('[update-my-phone] success:', { uid, from: oldPhone, to: cleanPhone });
    return res.status(200).json({ success: true, phone: cleanPhone });

  } catch (e) {
    console.error('[update-my-phone]', e.message);
    const body = { error: 'حدث خطأ داخلي' };
    if (IS_EMULATOR) body.debug = { message: e.message, code: e.code || null };
    return res.status(500).json(body);
  }
};
