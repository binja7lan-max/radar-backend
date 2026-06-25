const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { verifyAuth } = require('../lib/auth');

// ─── إرسال Push لمستخدم معيّن (يُستدعى من المتصفح مباشرة بعد كتابة notifications/{id}) ───
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    try { await verifyAuth(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

    const { userId, title, body, type, data } = req.body || {};
    if (!userId) return res.status(400).json({ error: 'userId مطلوب' });

    const db = admin.firestore();

    const tokensSnap = await db.collection('users').doc(userId).collection('tokens').get();
    if (tokensSnap.empty) return res.status(200).json({ sent: 0, reason: 'no-tokens' });

    const tokens = [...new Set(tokensSnap.docs.map(d => d.data().token).filter(Boolean))];
    if (!tokens.length) return res.status(200).json({ sent: 0, reason: 'no-tokens' });

    const notifTitle = title || 'رادار';
    const notifBody = body || 'لديك إشعار جديد';

    const message = {
      tokens,
      notification: { title: notifTitle, body: notifBody },
      data: {
        type: type || 'general',
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
