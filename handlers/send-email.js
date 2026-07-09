const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { sendMail } = require('../lib/mailer');
const { verifyAuth } = require('../lib/auth');

// ─── كل رسائل البريد المُرسلة من الباك إند مجمَّعة في ملف واحد (دُمجت 4 ملفات سابقة لتقليل عدد ملفات
// API تحت حد خطة Vercel المجانية: welcome / notification / password-reset / verification) ───
// نوع الرسالة يُحدَّد بحقل "type" في جسم الطلب — كل نوع يحتفظ بنفس منطقه ومتطلبات التحقق الأصلية كاملة

function escapeHTML(str) {
  if (str == null) return '';
  return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function welcomeEmailHTML(name) {
  name = escapeHTML(name);
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

async function handleWelcome(req, res, admin, db) {
  let decoded;
  try { decoded = await verifyAuth(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const { uid } = req.body || {};
  if (!uid) return res.status(400).json({ error: 'uid مطلوب' });
  if (decoded.uid !== uid) return res.status(403).json({ error: 'لا يمكنك تنفيذ هذا لمستخدم آخر' });

  const userSnap = await db.collection('users').doc(uid).get();
  if (!userSnap.exists) return res.status(200).json({ sent: false, reason: 'user-not-found' });
  const { name } = userSnap.data();
  let email = userSnap.data().email || null;
  if (!email) {
    const privateSnap = await db.collection('users').doc(uid).collection('private').doc('contact').get();
    email = privateSnap.exists ? privateSnap.data().email : null;
  }
  if (!email) return res.status(200).json({ sent: false, reason: 'no-email' });

  await sendMail({ to: email, subject: `أهلاً بك في رادار، ${name || ''}`, html: welcomeEmailHTML(name) });
  return res.status(200).json({ sent: true });
}

async function handleNotification(req, res, admin, db) {
  try { await verifyAuth(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  const { notifId } = req.body || {};
  if (!notifId) return res.status(400).json({ error: 'notifId مطلوب' });

  // المحتوى يُجلب من مستند الإشعار نفسه (مرّ بقواعد التحقق من النوع/الطول في Firestore)
  const notifSnap = await db.collection('notifications').doc(notifId).get();
  if (!notifSnap.exists) return res.status(404).json({ error: 'الإشعار غير موجود' });
  const { userId, type: notifType, title, body } = notifSnap.data();
  if (!userId || !notifType) return res.status(400).json({ error: 'إشعار غير صالح' });

  const settingsSnap = await db.collection('settings').doc('notificationChannels').get();
  const channelsForType = settingsSnap.exists ? (settingsSnap.data()[notifType] || {}) : {};
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
}

// لا يكشف أبداً إن كان البريد مسجّلاً أم لا — يرجع نجاحاً دائماً لمنع استكشاف الحسابات المسجّلة
async function handlePasswordReset(req, res, admin, db) {
  const { email } = req.body || {};
  if (!email) return res.status(400).json({ error: 'البريد الإلكتروني مطلوب' });

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
    const firebaseLink = await admin.auth().generatePasswordResetLink(email, { url: 'https://radarparts.net' });
    // استخراج oobCode وتوجيه الرابط لرادار مباشرة بدل صفحة Firebase الافتراضية
    const oobCode = new URL(firebaseLink).searchParams.get('oobCode');
    const link = oobCode
      ? `https://radarparts.net/?mode=resetPassword&oobCode=${encodeURIComponent(oobCode)}`
      : firebaseLink;
    await sendMail({ to: email, subject: 'تعيين كلمة المرور في رادار', html: resetEmailHTML(email, link) });
  } catch (e) {
    // لا نُفشل الطلب أو نكشف تفاصيل الخطأ — فقط نتجاهل الإرسال إن لم يوجد الحساب
    console.error('send-email password-reset inner error:', e.message);
  }
  return res.status(200).json({ success: true });
}

async function handleVerification(req, res, admin, db) {
  let decoded;
  try { decoded = await verifyAuth(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

  if (!decoded.email) return res.status(400).json({ error: 'لا يوجد بريد إلكتروني مرتبط بهذا الحساب' });
  if (decoded.email_verified) return res.status(200).json({ success: true, alreadyVerified: true });

  // حد بسيط لمنع إعادة الإرسال المتكرر: مرة واحدة كل دقيقتين لكل مستخدم
  const rlRef = db.collection('rateLimits').doc('verifyemail_' + decoded.uid);
  const rlSnap = await rlRef.get();
  const now = Date.now();
  if (rlSnap.exists && (now - rlSnap.data().lastSentAt) < 2 * 60 * 1000) {
    return res.status(429).json({ error: 'تم إرسال الرابط مؤخراً، انتظر قليلاً قبل إعادة المحاولة' });
  }
  await rlRef.set({ lastSentAt: now });

  const userSnap = await db.collection('users').doc(decoded.uid).get();
  const name = userSnap.exists ? (userSnap.data().name || 'مستخدم') : 'مستخدم';

  const link = await admin.auth().generateEmailVerificationLink(decoded.email, { url: 'https://radarparts.net' });
  await sendMail({
    to: decoded.email,
    subject: 'توثيق البريد الإلكتروني في رادار',
    html: verifyEmailHTML(name).replace('{{LINK}}', link)
  });
  return res.status(200).json({ success: true });
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    const db = admin.firestore();
    const { type } = req.body || {};

    if (type === 'welcome') return await handleWelcome(req, res, admin, db);
    if (type === 'notification') return await handleNotification(req, res, admin, db);
    if (type === 'password-reset') return await handlePasswordReset(req, res, admin, db);
    if (type === 'verification') return await handleVerification(req, res, admin, db);

    return res.status(400).json({ error: 'type غير صالح' });
  } catch (e) {
    console.error('send-email error:', e);
    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
};
