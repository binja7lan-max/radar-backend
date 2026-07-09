// تنبيه التجار الذين فعّلوا "تنبيهات الطلبات المناسبة" عند نشر طلب جديد.
// يُستدعى مرة واحدة لكل طلب (idempotent بحقل matchingNotificationsSent).
// TODO: إذا تجاوز عدد التجار 10,000، انقل البحث إلى Algolia/Typesense بدل Firestore query.
const { getAdmin }   = require('../lib/firebaseAdmin');
const { applyCors }  = require('../lib/cors');
const { verifyAuth } = require('../lib/auth');

const NOTIFY_LIMIT = 50; // حد تنبيهات المنصة — مستقل عن maxWhatsappSuppliersPerRequest

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin   = getAdmin();
    const decoded = await verifyAuth(req, admin);
    const db      = admin.firestore();

    const { requestId } = req.body || {};
    if (!requestId) return res.status(400).json({ error: 'requestId مطلوب' });

    const reqSnap = await db.collection('requests').doc(requestId).get();
    if (!reqSnap.exists) return res.status(404).json({ error: 'الطلب غير موجود' });
    const reqData = reqSnap.data();

    if (reqData.requesterId !== decoded.uid) {
      return res.status(403).json({ error: 'لا يمكنك تنبيه تجار لطلب لا تملكه' });
    }

    // idempotency — لا تكرر الإشعارات لنفس الطلب
    if (reqData.matchingNotificationsSent) {
      return res.status(200).json({
        alreadySent: true,
        notified:    reqData.matchingNotificationsCount || 0,
      });
    }

    const brand = (reqData.brand || '').trim();
    const city  = (reqData.city  || '').trim();

    // بناء query — نفلتر city/paused/self في Node.js لأن Firestore لا يدعم != مع array-contains
    let q = db.collection('users')
      .where('isDealer', '==', true)
      .where('requestAlertsEnabled', '==', true);
    if (brand) {
      q = q.where('dealerBrands', 'array-contains', brand);
    }
    // نجلب أكثر من NOTIFY_LIMIT بقليل لتعويض الصفوف المحذوفة بعد الفلترة
    q = q.limit(NOTIFY_LIMIT + 20);

    const snap = await q.get();
    const now  = admin.firestore.FieldValue.serverTimestamp();
    const batch = db.batch();
    let notified = 0;

    for (const dealerDoc of snap.docs) {
      if (notified >= NOTIFY_LIMIT) break;
      const dealer = dealerDoc.data();

      if (dealerDoc.id === decoded.uid) continue; // لا تُرسل لصاحب الطلب نفسه
      if (dealer.requestAlertsPaused) continue;    // موقوف مؤقتاً

      // فلتر نطاق المدينة
      const scope = dealer.requestAlertsScope || 'city';
      if (scope === 'city' && city && dealer.city !== city) continue;

      const notifRef = db.collection('notifications').doc();
      batch.set(notifRef, {
        userId:    dealerDoc.id,
        type:      'matching_request',
        requestId,
        title:     `طلب جديد: ${reqData.title || 'قطعة غيار'}`,
        body:      [reqData.brand, reqData.city].filter(Boolean).join(' — '),
        brand:     reqData.brand || '',
        city:      reqData.city  || '',
        data:      { requestId, fromName: 'رادار' },
        read:      false,
        source:    'auto_matching',
        createdAt: now,
      });
      notified++;
    }

    // تحديث الطلب بعلامة idempotency — مكتوب عبر Admin SDK فيتجاوز Firestore rules
    batch.update(db.collection('requests').doc(requestId), {
      matchingNotificationsSent:   true,
      matchingNotificationsSentAt: now,
      matchingNotificationsCount:  notified,
    });

    await batch.commit();

    return res.status(200).json({ notified });
  } catch (e) {
    console.error('[notify-matching-dealers]', e.message);
    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
};
