const crypto = require('crypto');
const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { verifyAuth, verifyStaff } = require('../lib/auth');

// ─── إرسال Push — يدعم مسارين في ملف واحد (دُمج لتقليل عدد الملفات تحت حد خطة Vercel المجانية) ───
// 1) إرسال لمستخدم واحد (userIds غير موجود): يُستدعى من المتصفح مباشرة بعد كتابة notifications/{id}
// 2) إرسال جماعي لعدة مستخدمين (userIds موجود): الإشعارات الجماعية من لوحة الأدمن، يتطلب صلاحية أدمن
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    const db = admin.firestore();
    const { notifId, userIds, title, body, type, action } = req.body || {};

    // ─── توقيع رفع Cloudinary ────────────────────────────────────────────────
    if (action === 'sign-cloudinary') {
      try { await verifyAuth(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }
      const timestamp = Math.round(Date.now() / 1000);
      const isRaw = req.body?.resourceType === 'raw';
      const folder = isRaw ? 'radar/docs' : 'radar';
      const paramsToSign = isRaw
        ? `folder=${folder}&resource_type=raw&timestamp=${timestamp}`
        : `folder=${folder}&timestamp=${timestamp}`;
      const signature = crypto.createHash('sha256')
        .update(paramsToSign + process.env.CLOUDINARY_API_SECRET)
        .digest('hex');
      return res.status(200).json({
        timestamp, signature, folder,
        api_key:    process.env.CLOUDINARY_API_KEY,
        cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
        ...(isRaw && { resource_type: 'raw' })
      });
    }

    if (Array.isArray(userIds) && userIds.length) {
      // ─── المسار الجماعي ───
      try { await verifyStaff(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

      const allTokens = [];
      const CONCURRENCY = 25;
      for (let i = 0; i < userIds.length; i += CONCURRENCY) {
        const chunk = userIds.slice(i, i + CONCURRENCY);
        const results = await Promise.all(
          chunk.map(uid => db.collection('users').doc(uid).collection('tokens').get())
        );
        results.forEach(snap => {
          snap.docs.forEach(d => { if (d.data().token) allTokens.push(d.data().token); });
        });
      }

      const tokens = [...new Set(allTokens)];
      if (!tokens.length) return res.status(200).json({ sent: 0, reason: 'no-tokens' });

      const notifTitle = title || 'رادار';
      const notifBody = body || '';

      let totalSuccess = 0, totalFailure = 0;
      // FCM يسمح بحد أقصى 500 توكن لكل استدعاء
      for (let i = 0; i < tokens.length; i += 500) {
        const batch = tokens.slice(i, i + 500);
        const response = await admin.messaging().sendEachForMulticast({
          tokens: batch,
          notification: { title: notifTitle, body: notifBody },
          data: { type: type || 'alert', url: '/' },
          webpush: {
            headers: { Urgency: 'high' },
            notification: {
              title: notifTitle, body: notifBody,
              icon: '/images/icon-192.svg', badge: '/images/icon-192.svg',
              dir: 'rtl', lang: 'ar'
            },
            fcmOptions: { link: '/' }
          }
        });
        totalSuccess += response.successCount;
        totalFailure += response.failureCount;
      }

      return res.status(200).json({ sent: totalSuccess, failed: totalFailure });
    }

    // ─── المسار الفردي ───
    try { await verifyAuth(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

    if (!notifId) return res.status(400).json({ error: 'notifId مطلوب' });

    // المحتوى يُجلب من مستند الإشعار نفسه (مرّ بقواعد التحقق من النوع/الطول في Firestore)
    // لا نقبل عنواناً/نصاً جاهزاً من الطالب — يمنع استخدام هذا المسار لإرسال محتوى عشوائي لأي مستخدم
    const notifSnap = await db.collection('notifications').doc(notifId).get();
    if (!notifSnap.exists) return res.status(404).json({ error: 'الإشعار غير موجود' });
    const { userId, title: notifDocTitle, body: notifDocBody, type: notifType, data } = notifSnap.data();
    if (!userId) return res.status(400).json({ error: 'إشعار غير صالح' });

    const tokensSnap = await db.collection('users').doc(userId).collection('tokens').get();
    if (tokensSnap.empty) return res.status(200).json({ sent: 0, reason: 'no-tokens' });

    const tokens = [...new Set(tokensSnap.docs.map(d => d.data().token).filter(Boolean))];
    if (!tokens.length) return res.status(200).json({ sent: 0, reason: 'no-tokens' });

    const notifTitle = notifDocTitle || 'رادار';
    const notifBody = notifDocBody || 'لديك إشعار جديد';

    const message = {
      tokens,
      notification: { title: notifTitle, body: notifBody },
      data: {
        type: notifType || 'general',
        convId: (data && data.convId) ? String(data.convId) : '',
        url: '/'
      },
      webpush: {
        headers: { Urgency: 'high' },
        notification: {
          title: notifTitle,
          body: notifBody,
          icon: '/images/icon-192.svg',
          badge: '/images/icon-192.svg',
          dir: 'rtl',
          lang: 'ar'
        },
        fcmOptions: { link: '/' }
      }
    };

    const response = await admin.messaging().sendEachForMulticast(message);

    // حذف التوكنات غير الصالحة (مستخدم أزال الإشعارات أو غيّر الجهاز)
    const invalidTokens = [];
    response.responses.forEach((r, idx) => {
      if (!r.success) {
        const code = r.error && r.error.code;
        if (code === 'messaging/invalid-registration-token' || code === 'messaging/registration-token-not-registered') {
          invalidTokens.push(tokens[idx]);
        }
      }
    });
    if (invalidTokens.length) {
      const batch = db.batch();
      tokensSnap.docs.forEach(d => {
        if (invalidTokens.includes(d.data().token)) batch.delete(d.ref);
      });
      await batch.commit();
    }

    return res.status(200).json({ sent: response.successCount, failed: response.failureCount });
  } catch (e) {
    console.error('send-push error:', e);
    return res.status(500).json({ error: e.message });
  }
};
