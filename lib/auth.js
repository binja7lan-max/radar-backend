// تحقق من هوية المستخدم وصلاحياته عبر Firebase ID token
// المرجع الأمني الوحيد للسوبر أدمن = UID (ثابت في جميع البيئات)
// البريد binja7lan@gmail.com محفوظ كـ SUPER_ADMIN_EMAIL للاستخدام في الإشعارات فقط
const SUPER_ADMIN_EMAIL = 'binja7lan@gmail.com';
const SUPER_ADMIN_UID   = 'laNUAfdtndMgGJ65IX1hWVd3UKp2';

function _isSuperAdmin(decoded) {
  return decoded.uid === SUPER_ADMIN_UID;
}

// أي مستخدم مسجّل دخوله فعلياً
async function verifyAuth(req, admin) {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    const e = new Error('يجب تسجيل الدخول'); e.status = 401; throw e;
  }
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch {
    const e = new Error('جلسة غير صالحة، سجّل الدخول مجدداً'); e.status = 401; throw e;
  }
}

// سوبر أدمن أو أحد فريق الإدارة (admins/{key}.active === true)
async function verifyStaff(req, admin) {
  const decoded = await verifyAuth(req, admin);
  if (_isSuperAdmin(decoded)) return decoded;
  const key = decoded.email.replace('@', '_at_').replace(/\./g, '_');
  const snap = await admin.firestore().collection('admins').doc(key).get();
  if (!snap.exists || snap.data().active !== true) {
    const e = new Error('غير مخوّل — لفريق الإدارة فقط'); e.status = 403; throw e;
  }
  return decoded;
}

// سوبر أدمن فقط
async function verifySuperAdmin(req, admin) {
  const decoded = await verifyAuth(req, admin);
  if (!_isSuperAdmin(decoded)) {
    const e = new Error('سوبر أدمن فقط'); e.status = 403; throw e;
  }
  return decoded;
}

module.exports = { SUPER_ADMIN_EMAIL, SUPER_ADMIN_UID, verifyAuth, verifyStaff, verifySuperAdmin };
