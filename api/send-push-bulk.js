const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { verifyStaff } = require('../lib/auth');

// ─── إرسال Push لعدة مستخدمين دفعة واحدة (الإشعارات الجماعية من لوحة الأدمن) ───
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    try { await verifyStaff(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

    const { userIds, title, body, type } = req.body || {};
    if (!Array.isArray(userIds) || !userIds.length) {
      return res.status(400).json({ error: 'userIds مطلوب' });
    }

    const db = admin.firestore();

    // جلب توكنات كل المستخدمين المستهدفين (بالتوازي على دفعات لتجنّب إغراق Firestore)
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
  } catch (e) {
    console.error('send-push-bulk error:', e);
    return res.status(500).json({ error: e.message });
  }
};
