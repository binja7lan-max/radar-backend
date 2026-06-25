
const SUPER_ADMIN_EMAIL = 'binja7lan@gmail.com';

async function verifyAuth(req, admin) {
  const authHeader = req.headers.authorization || '';
  const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!idToken) {
    const e = new Error('يجب تسجيل الدخول'); e.status = 401; throw e;
  }
  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (err) {
    const e = new Error('جلسة غير صالحة، سجّل الدخول مجدداً'); e.status = 401; throw e;
  }
}

async function verifyStaff(req, admin) {
  const decoded = await verifyAuth(req, admin);
  if (decoded.email === SUPER_ADMIN_EMAIL) return decoded;
  const key = decoded.email.replace('@', '_at_').replace(/\./g, '_');
  const snap = await admin.firestore().collection('admins').doc(key).get();
  if (!snap.exists || snap.data().active !== true) {
    const e = new Error('غير مخوّل — لفريق الإدارة فقط'); e.status = 403; throw e;
  }
  return decoded;
}

async function verifySuperAdmin(req, admin) {
  const decoded = await verifyAuth(req, admin);
  if (decoded.email !== SUPER_ADMIN_EMAIL) {
    const e = new Error('سوبر أدمن فقط'); e.status = 403; throw e;
  }
  return decoded;
}
