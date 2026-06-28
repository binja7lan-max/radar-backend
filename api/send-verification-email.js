const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { verifyAuth } = require('../lib/auth');
const { sendMail } = require('../lib/mailer');

function verifyEmailHTML(name) {
  return `
  <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f7fa;padding:24px;">
    <div style="background:#fff;border-radius:12px;padding:32px 28px;text-align:center;">
      <div style="font-size:24px;font-weight:800;color:#0C7BD1;margin-bottom:18px;">رادار</div>
      <div style="font-size:36px;margin-bottom:10px;">📧</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:18px;">مرحباً ${name}،</div>
      <div style="font-size:14px;color:#444;line-height:1.9;margin-bottom:22px;">
        اضغط على الرابط أدناه لتوثيق بريدك الإلكتروني في رادار.
      </div>
      <a href="{{LINK}}" style="display:inline-block;background:#0C7BD1;color:#fff;text-decoration:none;padding:13px 36px;border-radius:8px;font-weight:700;font-size:14px;margin-bottom:22px;">توثيق البريد الإلكتروني</a>
      <div style="font-size:13px;color:#888;line-height:1.8;margin-top:10px;">
        إذا لم تطلب هذا، يمكنك تجاهل هذه الرسالة.
      </div>
      <div style="font-size:14px;color:#444;margin-top:22px;">شكراً،<br>فريق رادار</div>
    </div>
  </div>`;
}

// ─── إرسال بريد توثيق البريد الإلكتروني بتصميم رادار الخاص (بدل قالب Firebase الافتراضي) ───
// يتطلب تسجيل دخول فعلي (لا يمكن طلب توثيق بريد شخص آخر)
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    let decoded;
    try { decoded = await verifyAuth(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

    if (!decoded.email) return res.status(400).json({ error: 'لا يوجد بريد إلكتروني مرتبط بهذا الحساب' });
    if (decoded.email_verified) return res.status(200).json({ success: true, alreadyVerified: true });

    // حد بسيط لمنع إعادة الإرسال المتكرر: مرة واحدة كل دقيقتين لكل مستخدم
    const db = admin.firestore();
    const rlRef = db.collection('rateLimits').doc('verifyemail_' + decoded.uid);
    const rlSnap = await rlRef.get();
    const now = Date.now();
    if (rlSnap.exists && (now - rlSnap.data().lastSentAt) < 2 * 60 * 1000) {
      return res.status(429).json({ error: 'تم إرسال الرابط مؤخراً، انتظر قليلاً قبل إعادة المحاولة' });
    }
    await rlRef.set({ lastSentAt: now });

    const userSnap = await db.collection('users').doc(decoded.uid).get();
    const name = userSnap.exists ? (userSnap.data().name || 'مستخدم') : 'مستخدم';

    const link = await admin.auth().generateEmailVerificationLink(decoded.email, {
      url: 'https://radarparts.net'
    });
    await sendMail({
      to: decoded.email,
      subject: 'توثيق البريد الإلكتروني في رادار',
      html: verifyEmailHTML(name).replace('{{LINK}}', link)
    });

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('send-verification-email error:', e);
    return res.status(500).json({ error: e.message });
  }
};
