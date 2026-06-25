const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { sendMail } = require('../lib/mailer');

function welcomeEmailHTML(name) {
  return `
  <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f7fa;padding:24px;">
    <div style="background:#fff;border-radius:12px;padding:28px;">
      <div style="font-size:24px;font-weight:800;color:#0C7BD1;margin-bottom:6px;">رادار</div>
      <div style="font-size:13px;color:#888;margin-bottom:20px;">سوق قطع الغيار الأول في المملكة</div>
      <div style="font-size:17px;font-weight:700;margin-bottom:14px;">أهلاً بك ${name || ''} 👋</div>
      <div style="font-size:14px;color:#444;line-height:1.9;margin-bottom:20px;">
        يسعدنا انضمامك إلى رادار! يمكنك الآن:
        <ul style="padding-right:18px;margin:10px 0;">
          <li>تصفح آلاف إعلانات قطع الغيار من بائعين موثوقين</li>
          <li>نشر إعلان لبيع قطعة لديك مجاناً</li>
          <li>إضافة طلب لقطعة تبحث عنها ليصلك عرضها من التجار</li>
          <li>التواصل المباشر مع البائعين عبر الموقع أو واتساب</li>
        </ul>
      </div>
      <a href="https://radarparts.net" style="display:inline-block;background:#0C7BD1;color:#fff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;">زيارة الموقع</a>
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #eee;font-size:11px;color:#999;">
        وصلتك هذه الرسالة لأنك أنشأت حساباً جديداً على radarparts.net
      </div>
    </div>
  </div>`;
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { uid } = req.body || {};
    if (!uid) return res.status(400).json({ error: 'uid مطلوب' });

    const admin = getAdmin();
    const userSnap = await admin.firestore().collection('users').doc(uid).get();
    if (!userSnap.exists) return res.status(200).json({ sent: false, reason: 'user-not-found' });
    const { email, name } = userSnap.data();
    if (!email) return res.status(200).json({ sent: false, reason: 'no-email' });

    await sendMail({ to: email, subject: `أهلاً بك في رادار، ${name || ''}`, html: welcomeEmailHTML(name) });

    return res.status(200).json({ sent: true });
  } catch (e) {
    console.error('send-welcome-email error:', e);
    return res.status(500).json({ error: e.message });
  }
};
