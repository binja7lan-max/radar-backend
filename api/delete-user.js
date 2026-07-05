const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { deleteImages } = require('../lib/cloudinary');

const SUPER_ADMIN_EMAIL = 'binja7lan@gmail.com';
const SUPER_ADMIN_UID  = 'laNUAfdtndMgGJ65IX1hWVd3UKp2';

// يحذف كل مستندات نتيجة استعلام على دفعات (حد الدفعة في Firestore هو 500 عملية)
async function deleteAllDocs(db, docs) {
  let count = 0;
  for (let i = 0; i < docs.length; i += 450) {
    const chunk = docs.slice(i, i + 450);
    const batch = db.batch();
    chunk.forEach(d => batch.delete(d.ref));
    await batch.commit();
    count += chunk.length;
  }
  return count;
}

// ─── حذف جميع المستخدمين التجريبيين دفعة واحدة (سوبر أدمن فقط — غير قابل للتراجع) ───
async function handlePurgeAll(req, res, admin, db) {
  const collectionsToWipe = ['listings', 'requests', 'conversations', 'ratings', 'notifications', 'rateLimits', 'moderationLog', 'phoneIndex'];

  // حذف مجموعات كاملة (الإعلانات، المحادثات، إلخ)
  for (const col of collectionsToWipe) {
    let snap = await db.collection(col).limit(400).get();
    while (!snap.empty) {
      const batch = db.batch();
      snap.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
      snap = await db.collection(col).limit(400).get();
    }
  }

  // حذف كل المستخدمين عدا السوبر أدمن (Firebase Auth + Firestore)
  let pageToken;
  let deletedCount = 0;
  do {
    const listResult = await admin.auth().listUsers(100, pageToken);
    const toDelete = listResult.users.filter(u => u.uid !== SUPER_ADMIN_UID);
    for (const user of toDelete) {
      try {
        // حذف subcollections (tokens, private)
        const tokensSnap = await db.collection('users').doc(user.uid).collection('tokens').get();
        const privateSnap = await db.collection('users').doc(user.uid).collection('private').get();
        const subBatch = db.batch();
        [...tokensSnap.docs, ...privateSnap.docs].forEach(d => subBatch.delete(d.ref));
        if (tokensSnap.docs.length || privateSnap.docs.length) await subBatch.commit();
        // حذف المستند العام
        await db.collection('users').doc(user.uid).delete();
        // حذف من Auth
        await admin.auth().deleteUser(user.uid);
        deletedCount++;
      } catch(e) { console.error('purge user error', user.uid, e.message); }
    }
    pageToken = listResult.pageToken;
  } while (pageToken);

  return res.status(200).json({ success: true, deletedUsers: deletedCount });
}

// ─── حذف نهائي لمستخدم وكل ما يخصه (سوبر أدمن فقط — غير قابل للتراجع) ───
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    const db = admin.firestore();
    const { action } = req.body || {};

    // مسار حذف جميع المستخدمين التجريبيين
    if (action === 'purgeAllTestUsers') {
      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!idToken) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
      const decoded = await admin.auth().verifyIdToken(idToken);
      if (decoded.uid !== SUPER_ADMIN_UID) return res.status(403).json({ error: 'سوبر أدمن فقط' });
      return await handlePurgeAll(req, res, admin, db);
    }

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
      return res.status(403).json({ error: 'سوبر أدمن فقط يمكنه حذف المستخدمين نهائياً' });
    }

    const { uid } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'uid مطلوب' });


    // التحقق من البريد عبر Firebase Auth نفسه (موثوق دائماً)، لا من حقل قد لا يكون مخزّناً على المستند العام
    try {
      const targetAuthUser = await admin.auth().getUser(uid);
      if (targetAuthUser.email === SUPER_ADMIN_EMAIL) {
        return res.status(403).json({ error: 'لا يمكن حذف حساب السوبر أدمن' });
      }
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }

    const deletedCounts = {};

    // 0) جمع روابط الصور (الملف الشخصي والإعلانات) لحذفها فعلياً من Cloudinary بعد حذف المستندات
    const userDataSnap = await db.collection('users').doc(uid).get();
    const userImages = userDataSnap.exists
      ? [userDataSnap.data().photoURL, userDataSnap.data().coverURL].filter(Boolean)
      : [];

    // 1) الإعلانات
    const listingsSnap = await db.collection('listings').where('sellerId', '==', uid).get();
    const listingImages = listingsSnap.docs.flatMap(d => d.data().images || []);
    deletedCounts.listings = await deleteAllDocs(db, listingsSnap.docs);

    // 2) الطلبات
    const requestsSnap = await db.collection('requests').where('requesterId', '==', uid).get();
    deletedCounts.requests = await deleteAllDocs(db, requestsSnap.docs);

    // 3) المحادثات (كمشتري أو بائع) + رسائلها
    const [convsAsBuyer, convsAsSeller] = await Promise.all([
      db.collection('conversations').where('buyerId', '==', uid).get(),
      db.collection('conversations').where('sellerId', '==', uid).get()
    ]);
    const convDocsMap = new Map();
    [...convsAsBuyer.docs, ...convsAsSeller.docs].forEach(d => convDocsMap.set(d.id, d));
    const convDocs = [...convDocsMap.values()];
    let messagesDeleted = 0;
    for (const convDoc of convDocs) {
      const msgsSnap = await convDoc.ref.collection('messages').get();
      messagesDeleted += await deleteAllDocs(db, msgsSnap.docs);
    }
    deletedCounts.conversations = await deleteAllDocs(db, convDocs);
    deletedCounts.messages = messagesDeleted;

    // 4) التقييمات (كمقيِّم أو مُقيَّم)
    const [ratingsAsRater, ratingsAsRated] = await Promise.all([
      db.collection('ratings').where('raterId', '==', uid).get(),
      db.collection('ratings').where('ratedId', '==', uid).get()
    ]);
    const ratingDocsMap = new Map();
    [...ratingsAsRater.docs, ...ratingsAsRated.docs].forEach(d => ratingDocsMap.set(d.id, d));
    deletedCounts.ratings = await deleteAllDocs(db, [...ratingDocsMap.values()]);

    // 5) الإشعارات الداخلية
    const notifsSnap = await db.collection('notifications').where('userId', '==', uid).get();
    deletedCounts.notifications = await deleteAllDocs(db, notifsSnap.docs);

    // 6) توكنات الإشعارات (Push)
    const tokensSnap = await db.collection('users').doc(uid).collection('tokens').get();
    deletedCounts.tokens = await deleteAllDocs(db, tokensSnap.docs);

    // 6.1) المستندات الخاصة + استخراج الجوال قبل الحذف لتنظيف phoneIndex
    const contactSnap = await db.collection('users').doc(uid).collection('private').doc('contact').get();
    const userPhone = contactSnap.exists ? (contactSnap.data().phone || null) : null;
    const privateSnap = await db.collection('users').doc(uid).collection('private').get();
    deletedCounts.private = await deleteAllDocs(db, privateSnap.docs);

    // 6.2) حذف فهرس الجوال إن وُجد
    if (userPhone) {
      await db.collection('phoneIndex').doc(userPhone).delete().catch(() => {});
    }

    // 7) مستند المستخدم نفسه
    await db.collection('users').doc(uid).delete();

    // 8) حساب تسجيل الدخول (Firebase Auth)
    try {
      await admin.auth().deleteUser(uid);
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }

    // 9) حذف الصور فعلياً من Cloudinary (بعد نجاح حذف كل شيء من القاعدة)
    const allImages = [...userImages, ...listingImages];
    deletedCounts.images = allImages.length;
    await deleteImages(allImages);

    return res.status(200).json({ success: true, deletedCounts });
  } catch (e) {
    console.error('delete-user error:', e);
    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
};
