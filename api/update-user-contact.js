const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { verifySuperAdmin } = require('../lib/auth');
const { sendMail } = require('../lib/mailer');

function verifyEmailHTML(name) {
  return `
  <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f7fa;padding:24px;">
    <div style="background:#fff;border-radius:12px;padding:32px 28px;text-align:center;">
      <div style="font-size:24px;font-weight:800;color:#0C7BD1;margin-bottom:18px;">رادار</div>
      <div style="font-size:36px;margin-bottom:10px;">📧</div>
      <div style="font-size:16px;font-weight:700;margin-bottom:18px;">مرحباً ${name}،</div>
      <div style="font-size:14px;color:#444;line-height:1.9;margin-bottom:22px;">
        تم تحديث البريد الإلكتروني لحسابك في رادار. اضغط على الرابط أدناه لتوثيق هذا البريد.
      </div>
      <a href="{{LINK}}" style="display:inline-block;background:#0C7BD1;color:#fff;text-decoration:none;padding:13px 36px;border-radius:8px;font-weight:700;font-size:14px;margin-bottom:22px;">توثيق البريد الإلكتروني</a>
      <div style="font-size:13px;color:#888;line-height:1.8;margin-top:10px;">
        إذا لم تطلب هذا التغيير، تواصل مع إدارة رادار فوراً.
      </div>
      <div style="font-size:14px;color:#444;margin-top:22px;">شكراً،<br>فريق رادار</div>
    </div>
  </div>`;
}

// ─── تعديل بريد/جوال أي مستخدم — سوبر أدمن فقط ───
// تعديل البريد: يغيّر بريد حساب Auth الفعلي + يُعيّن غير موثّق + يرسل رابط توثيق فوراً للبريد الجديد
// تعديل الجوال: يُطبَّق مباشرة بلا توثيق إضافي (لا يوجد مزوّد SMS مفعّل في هذا المشروع)
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    try { await verifySuperAdmin(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

    const { uid, newEmail, newPhone } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'uid مطلوب' });
    if (!newEmail && !newPhone) return res.status(400).json({ error: 'أدخل بريداً جديداً أو رقم جوال جديد على الأقل' });

    const db = admin.firestore();
    const result = {};

    if (newEmail) {
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return res.status(400).json({ error: 'صيغة البريد الإلكتروني غير صحيحة' });
      }
      try {
        await admin.auth().updateUser(uid, { email: newEmail, emailVerified: false });
      } catch (e) {
        if (e.code === 'auth/email-already-exists') {
          return res.status(409).json({ error: 'هذا البريد مستخدم بالفعل لحساب آخر' });
        }
        throw e;
      }
      await db.collection('users').doc(uid).collection('private').doc('contact').set({ email: newEmail }, { merge: true });

      const userSnap = await db.collection('users').doc(uid).get();
      const name = userSnap.exists ? (userSnap.data().name || 'مستخدم') : 'مستخدم';
      try {
        const link = await admin.auth().generateEmailVerificationLink(newEmail, { url: 'https://radarparts.net' });
        await sendMail({ to: newEmail, subject: 'توثيق البريد الإلكتروني في رادار', html: verifyEmailHTML(name).replace('{{LINK}}', link) });
        result.verificationEmailSent = true;
      } catch (e) {
        console.error('update-user-contact verification email error:', e.message);
        result.verificationEmailSent = false;
      }
    }

    if (newPhone) {
      // تطبيع رقم الجوال: إزالة أي رموز/مسافات، وإضافة الصفر الأول تلقائياً إذا أُدخل بدونه
      let cleanPhone = String(newPhone).replace(/\D/g, '');
      if (/^5\d{8}$/.test(cleanPhone)) cleanPhone = '0' + cleanPhone;
      if (!/^05\d{8}$/.test(cleanPhone)) {
        return res.status(400).json({ error: 'رقم الجوال غير صحيح — يجب أن يكون 10 خانات ويبدأ بـ 05' });
      }
      const dup = await db.collection('users').where('phone', '==', cleanPhone).limit(1).get();
      if (!dup.empty && dup.docs[0].id !== uid) {
        return res.status(409).json({ error: 'رقم الجوال مستخدم مسبقاً بحساب آخر' });
      }
      await db.collection('users').doc(uid).update({ phone: cleanPhone });
      result.normalizedPhone = cleanPhone;
    }

    return res.status(200).json({ success: true, ...result });
  } catch (e) {
    console.error('update-user-contact error:', e);
    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
};
