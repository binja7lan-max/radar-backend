const { getAdmin } = require('../lib/firebaseAdmin');

const LISTING_LIFETIME_MS = 14 * 24 * 60 * 60 * 1000;

function isExpired(item) {
  const expiresAtMs = item.expiresAt?.toMillis ? item.expiresAt.toMillis() : null;
  if (expiresAtMs != null) return expiresAtMs < Date.now();
  const createdMs = item.createdAt?.toMillis ? item.createdAt.toMillis() : 0;
  if (!createdMs) return false;
  return (createdMs + LISTING_LIFETIME_MS) < Date.now();
}

// ─── يُستدعى يومياً عبر Vercel Cron — يفحص الإعلانات/الطلبات التي انتهت صلاحيتها للتو ويُنشئ إشعاراً داخلياً لصاحبها مرة واحدة فقط ───
module.exports = async (req, res) => {
  const authHeader = req.headers.authorization || '';
  if (!process.env.CRON_SECRET || authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const admin = getAdmin();
    const db = admin.firestore();
    let notified = 0;

    const listingsSnap = await db.collection('listings').where('status', '==', 'active').get();
    for (const docSnap of listingsSnap.docs) {
      const l = docSnap.data();
      if (!isExpired(l) || l.expiryNotifiedAt) continue;
      await db.collection('notifications').add({
        userId: l.sellerId, type: 'system',
        title: '⏰ انتهت صلاحية إعلانك',
        body: `إعلان "${l.title || ''}" اختفى من نتائج البحث — حدّثه من لوحة التحكم لإعادة تفعيله`,
        data: { listingId: docSnap.id, fromName: 'رادار' }, read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await docSnap.ref.update({ expiryNotifiedAt: admin.firestore.FieldValue.serverTimestamp() });
      notified++;
    }

    const requestsSnap = await db.collection('requests').where('status', '==', 'active').get();
    for (const docSnap of requestsSnap.docs) {
      const r = docSnap.data();
      if (!isExpired(r) || r.expiryNotifiedAt) continue;
      await db.collection('notifications').add({
        userId: r.requesterId, type: 'system',
        title: '⏰ انتهت صلاحية طلبك',
        body: `طلب "${r.title || ''}" اختفى من نتائج البحث — حدّثه من لوحة التحكم لإعادة تفعيله`,
        data: { requestId: docSnap.id, fromName: 'رادار' }, read: false,
        createdAt: admin.firestore.FieldValue.serverTimestamp()
      });
      await docSnap.ref.update({ expiryNotifiedAt: admin.firestore.FieldValue.serverTimestamp() });
      notified++;
    }

    return res.status(200).json({ success: true, notified });
  } catch (e) {
    console.error('check-expiring error:', e);
    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
};
