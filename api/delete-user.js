

const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');

const SUPER_ADMIN_EMAIL = 'binja7lan@gmail.com';

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

// ─── حذف نهائي لمستخدم وكل ما يخصه (سوبر أدمن فقط — غير قابل للتراجع) ───
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
      return res.status(403).json({ error: 'سوبر أدمن فقط يمكنه حذف المستخدمين نهائياً' });
    }

    const { uid } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'uid مطلوب' });

    const db = admin.firestore();

    const targetSnap = await db.collection('users').doc(uid).get();
    const targetData = targetSnap.exists ? targetSnap.data() : null;
    if (targetData && targetData.email === SUPER_ADMIN_EMAIL) {
      return res.status(403).json({ error: 'لا يمكن حذف حساب السوبر أدمن' });
    }

    const deletedCounts = {};

    // 1) الإعلانات
    const listingsSnap = await db.collection('listings').where('sellerId', '==', uid).get();
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

    // 7) مستند المستخدم نفسه
    await db.collection('users').doc(uid).delete();

    // 8) حساب تسجيل الدخول (Firebase Auth)
    try {
      await admin.auth().deleteUser(uid);
    } catch (e) {
      if (e.code !== 'auth/user-not-found') throw e;
    }

    return res.status(200).json({ success: true, deletedCounts });
  } catch (e) {
    console.error('delete-user error:', e);
    return res.status(500).json({ error: e.message });
  }
};
