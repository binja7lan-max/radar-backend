const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { validateCreateUserInput, firebaseAuthErrorMsg } = require('../lib/validators');

const SUPER_ADMIN_UID = 'laNUAfdtndMgGJ65IX1hWVd3UKp2';
const IS_NON_PROD     = process.env.APP_ENV !== 'production';

// أي 500 غير متوقع: في dev يُرجع debug، في production يُرجع رسالة عامة
function fail500(res, e, stage) {
  console.error('[create-user] fail:', { stage, code: e.code || null, message: e.message });
  const body = { error: 'حدث خطأ داخلي' };
  if (IS_NON_PROD) body.debug = { stage, code: e.code || null, message: e.message };
  return res.status(500).json(body);
}

// فشل Firestore بعد إنشاء Auth — مع rollback
function failFirestore(res, e, stage, uid, admin) {
  console.error('[create-user] firestore fail + rollback:', { stage, code: e.code || null, message: e.message, uid });
  admin.auth().deleteUser(uid).catch(re => console.error('[create-user] rollback failed:', re.message));
  const body = { error: 'فشل حفظ بيانات المستخدم بعد إنشاء الحساب، وتم التراجع عن حساب Auth' };
  if (IS_NON_PROD) body.debug = { stage, code: e.code || null, message: e.message };
  return res.status(500).json(body);
}

// ─── استيراد مستخدم جديد (سوبر أدمن فقط) ────────────────────────────────────
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // Log كل طلب في dev/emulator (بدون password)
  if (IS_NON_PROD) {
    console.log('[create-user] request:', {
      email:      req.body?.email,
      phone:      req.body?.phone,
      name:       req.body?.name,
      isNonProd: IS_NON_PROD,
    });
  }

  // ─── outer catch-all لأي خطأ غير متوقع ──────────────────────────────────
  try {

    // ─── get-admin ───────────────────────────────────────────────────────
    let admin;
    try {
      admin = getAdmin();
    } catch (e) {
      return fail500(res, e, 'get-admin');
    }

    // ─── verify-token ────────────────────────────────────────────────────
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!idToken) return res.status(401).json({ error: 'يجب تسجيل الدخول' });

    let decoded;
    try {
      decoded = await admin.auth().verifyIdToken(idToken);
    } catch (e) {
      console.error('[create-user] verify-token failed:', { code: e.code, message: e.message });
      return res.status(401).json({ error: 'جلسة غير صالحة، سجّل الدخول مجدداً' });
    }

    // ─── authorization ────────────────────────────────────────────────────
    if (decoded.uid !== SUPER_ADMIN_UID) {
      return res.status(403).json({ error: 'سوبر أدمن فقط يمكنه استيراد مستخدمين' });
    }

    // ─── validate ────────────────────────────────────────────────────────
    const validation = validateCreateUserInput(req.body);
    if (!validation.ok) {
      return res.status(validation.status).json({ error: validation.error });
    }
    const { name, email, password, phone, city, isDealer, dealerBrands, verified } = validation.normalized;

    if (IS_NON_PROD) console.log('[create-user] validated:', { email, phone, city });

    const db = admin.firestore();

    // ─── duplicate-phone ──────────────────────────────────────────────────
    if (phone) {
      let dupSnap;
      try {
        dupSnap = await db.collection('phoneIndex').doc(phone).get();
      } catch (e) {
        return fail500(res, e, 'duplicate-phone');
      }
      if (dupSnap.exists) {
        return res.status(409).json({ error: 'رقم الجوال مستخدم مسبقاً' });
      }
    }

    // ─── auth-create ──────────────────────────────────────────────────────
    let userRecord;
    try {
      userRecord = await admin.auth().createUser({ email, password, displayName: name });
      if (IS_NON_PROD) console.log('[create-user] auth-create OK:', userRecord.uid);
    } catch (e) {
      const arabicMsg = firebaseAuthErrorMsg(e);
      if (arabicMsg) {
        const status = e.code === 'auth/email-already-exists' ? 409 : 400;
        return res.status(status).json({ error: arabicMsg });
      }
      return fail500(res, e, 'auth-create');
    }

    // ─── firestore-users ──────────────────────────────────────────────────
    try {
      await db.collection('users').doc(userRecord.uid).set({
        name, city, isDealer, dealerBrands, verified,
        banned: false, ratingAvg: 0, ratingCount: 0,
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    } catch (e) {
      return failFirestore(res, e, 'firestore-users', userRecord.uid, admin);
    }

    // ─── firestore-contact ────────────────────────────────────────────────
    try {
      await db.collection('users').doc(userRecord.uid).collection('private').doc('contact').set({
        email, phone: phone || '',
      });
    } catch (e) {
      return failFirestore(res, e, 'firestore-contact', userRecord.uid, admin);
    }

    // ─── phone-index ──────────────────────────────────────────────────────
    if (phone) {
      try {
        await db.collection('phoneIndex').doc(phone).set({ uid: userRecord.uid });
      } catch (e) {
        // الحساب أُنشئ بنجاح — phone-index فشله لا يستدعي rollback
        console.error('[create-user] phone-index write failed:', { code: e.code, message: e.message, phone });
      }
    }

    if (IS_NON_PROD) console.log('[create-user] success:', userRecord.uid);
    return res.status(200).json({ uid: userRecord.uid, success: true });

  } catch (e) {
    // catch-all للأخطاء غير المتوقعة تماماً
    return fail500(res, e, 'unknown');
  }
};
