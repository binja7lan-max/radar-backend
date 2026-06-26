const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { sendMail } = require('../lib/mailer');
const { verifyAuth } = require('../lib/auth');

function escapeHTML(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function wrapEmailHTML(title, body) {
  title = escapeHTML(title);
  body = escapeHTML(body);
  return `
  <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f7fa;padding:24px;">
    <div style="background:#fff;border-radius:12px;padding:24px;">
      <div style="font-size:20px;font-weight:800;color:#0C7BD1;margin-bottom:16px;">رادار</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:10px;">${title}</div>
      <div style="font-size:14px;color:#444;line-height:1.8;">${body}</div>
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#999;">
        وصلتك هذه الرسالة لأنها مرتبطة بنشاطك على موقع رادار (radarparts.net)
      </div>
    </div>
  </div>`;
}

// ─── إرسال إشعار بالبريد الإلكتروني — فقط إذا كانت القناة مفعّلة لهذا النوع من لوحة الأدمن ───
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    try { await verifyAuth(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

    const { notifId } = req.body || {};
    if (!notifId) return res.status(400).json({ error: 'notifId مطلوب' });

    const db = admin.firestore();

    // المحتوى يُجلب من مستند الإشعار نفسه (مرّ بقواعد التحقق من النوع/الطول في Firestore)
    const notifSnap = await db.collection('notifications').doc(notifId).get();
    if (!notifSnap.exists) return res.status(404).json({ error: 'الإشعار غير موجود' });
    const { userId, type, title, body } = notifSnap.data();
    if (!userId || !type) return res.status(400).json({ error: 'إشعار غير صالح' });

    const settingsSnap = await db.collection('settings').doc('notificationChannels').get();
    const channelsForType = settingsSnap.exists ? (settingsSnap.data()[type] || {}) : {};
    if (!channelsForType.email) {
      return res.status(200).json({ sent: false, reason: 'channel-disabled' });
    }

    const userSnap = await db.collection('users').doc(userId).get();
    let email = userSnap.exists ? userSnap.data().email : null;
    if (!email) {
      const privateSnap = await db.collection('users').doc(userId).collection('private').doc('contact').get();
      email = privateSnap.exists ? privateSnap.data().email : null;
    }
    if (!email) return res.status(200).json({ sent: false, reason: 'no-email' });

    await sendMail({ to: email, subject: title || 'إشعار جديد من رادار', html: wrapEmailHTML(title || 'رادار', body || '') });

    return res.status(200).json({ sent: true });
  } catch (e) {
    console.error('send-notification-email error:', e);
    return res.status(500).json({ error: e.message });
  }
};
