const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { sendMail } = require('../lib/mailer');

function escapeHTML(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function resetEmailHTML(email, link) {
  const safeEmail = escapeHTML(email);
  return `
  <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f7fa;padding:24px;">
    <div style="background:#fff;border-radius:12px;padding:32px 28px;text-align:center;">
      <div style="font-size:24px;font-weight:800;color:#0C7BD1;margin-bottom:18px;">رادار</div>
      <div style="font-size:36px;margin-bottom:10px;">🔐</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:18px;">مرحباً،</div>
      <div style="font-size:14px;color:#444;line-height:1.9;margin-bottom:22px;">
        اتبع هذا الرابط لإعادة تعيين كلمة مرور حسابك (${safeEmail}) على radarparts.net.
      </div>
      <a href="${link}" style="display:inline-block;background:#0C7BD1;color:#fff;text-decoration:none;padding:13px 36px;border-radius:8px;font-weight:700;font-size:14px;margin-bottom:22px;">اضغط هنا</a>
      <div style="font-size:13px;color:#888;line-height:1.8;margin-top:10px;">
        إذا لم تطلب إعادة تعيين كلمة مرورك، يمكنك تجاهل هذه الرسالة.
      </div>
      <div style="font-size:14px;color:#444;margin-top:22px;">شكراً،<br>فريق رادار</div>
    </div>
  </div>`;
}

// ─── إرسال بريد إعادة تعيين كلمة المرور بتصميم رادار الخاص (بدل قالب Firebase الافتراضي) ───
// لا يكشف أبداً إن كان البريد مسجّلاً أم لا — يرجع نجاحاً دائماً لمنع استكشاف الحسابات المسجّلة
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });

    const admin = getAdmin();
    const db = admin.firestore();

    // حد بسيط لمنع إرهاق بريد شخص آخر برسائل إعادة تعيين متكررة: 3 طلبات كل 15 دقيقة لكل بريد
    const RATE_WINDOW_MS = 15 * 60 * 1000;
    const RATE_MAX = 3;
    const rlRef = db.collection('rateLimits').doc('pwreset_' + email.trim().toLowerCase());
    const rlSnap = await rlRef.get();
    const now = Date.now();
    if (rlSnap.exists && (now - rlSnap.data().windowStart) < RATE_WINDOW_MS) {
      if (rlSnap.data().count >= RATE_MAX) {
        return res.status(429).json({ error: 'محاولات كثيرة، حاول مرة أخرى بعد قليل' });
      }
      await rlRef.update({ count: admin.firestore.FieldValue.increment(1) });
    } else {
      await rlRef.set({ count: 1, windowStart: now });
    }

    try {
      const link = await admin.auth().generatePasswordResetLink(email, {
        url: 'https://radarparts.net'
      });
      await sendMail({
        to: email,
        subject: 'تعيين كلمة المرور في رادار',
        html: resetEmailHTML(email, link)
      });
    } catch (e) {
      // لا نُفشل الطلب أو نكشف تفاصيل الخطأ — فقط نتجاهل الإرسال إن لم يوجد الحساب
      console.error('send-password-reset inner error:', e.message);
    }

    return res.status(200).json({ success: true });
  } catch (e) {
    console.error('send-password-reset error:', e);
    return res.status(500).json({ error: e.message });
  }
};
