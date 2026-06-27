const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { verifyAuth } = require('../lib/auth');
const { sendMail } = require('../lib/mailer');

const SUPER_ADMIN_EMAIL = 'binja7lan@gmail.com';
const FLAG_THRESHOLD = 3; // عدد المخالفات قبل تقييد الحساب من النشر تلقائياً

// أرقام شائعة الاستخدام للتحايل على الفلترة (Arabizi) → الحرف الذي تمثّله
const LEET_MAP = { '7': 'ح', '3': 'ع', '5': 'خ', '8': 'غ', '2': 'ء', '6': 'ط' };

// يطبّع النص لإزالة أكثر طرق التحايل شيوعاً قبل المطابقة: تشكيل، تطويل، رموز، مسافات، همزات، أرقام بديلة
function normalize(text) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/[ً-ٰٟۖ-ۭ]/g, ''); // التشكيل
  s = s.replace(/ـ/g, ''); // التطويل (الكشيدة)
  s = s.replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه'); // توحيد الهمزات/الألف/التاء المربوطة
  s = s.replace(/[0-9]/g, d => LEET_MAP[d] || d); // أرقام تحايل شائعة
  s = s.toLowerCase();
  s = s.replace(/[^ء-ي٠-٩a-z]/g, ''); // إزالة كل الرموز/المسافات/علامات الترقيم — يبقي الحروف فقط
  return s;
}

function findMatch(normalizedText, keywords) {
  for (const kw of (keywords || [])) {
    const nk = normalize(kw);
    if (nk && normalizedText.includes(nk)) return kw;
  }
  return null;
}

async function notifyAdmins(admin, db, payload) {
  // يصل التنبيه للسوبر أدمن + كل حساب أدمن مفعّل لديه صلاحية "الفلترة" في مصفوفة الصلاحيات
  const recipients = [];
  try {
    const superUserSnap = await db.collection('users').where('email', '==', SUPER_ADMIN_EMAIL).limit(1).get();
    if (!superUserSnap.empty) recipients.push({ uid: superUserSnap.docs[0].id, email: SUPER_ADMIN_EMAIL });
  } catch (e) { console.error('notifyAdmins super lookup error:', e.message); }

  try {
    const permsSnap = await db.collection('admins').doc('_permissions_config').get();
    const perms = permsSnap.exists ? permsSnap.data() : {};
    const adminsByUidSnap = await db.collection('adminsByUid').get();
    adminsByUidSnap.docs.forEach(d => {
      const data = d.data();
      if (!data.active || !data.email) return;
      const roleConfig = perms[data.role] || {};
      if (roleConfig.moderation) recipients.push({ uid: d.id, email: data.email });
    });
  } catch (e) { console.error('notifyAdmins lookup error:', e.message); }

  if (!recipients.length) return;

  // إشعار داخل المنصة — يصل دائماً بغض النظر عن إعدادات القنوات (نفس سلوك الإشعارات الداخلية في باقي الموقع)
  await Promise.all(recipients.map(r => db.collection('notifications').add({
    userId: r.uid, type: 'system',
    title: '🚨 محاولة نشر محتوى محظور',
    body: `${payload.itemType === 'listing' ? 'إعلان' : 'طلب'} "${payload.title || ''}" — ${payload.categoryLabel}`,
    data: { fromName: 'رادار' }, read: false,
    createdAt: admin.firestore.FieldValue.serverTimestamp()
  }).catch(e => console.error('notify in-app error:', e.message))));

  // البريد الإلكتروني — فقط إذا كانت القناة مفعّلة لهذا النوع من لوحة الأدمن (افتراضياً مفعّلة لأنها مخالفة حرجة)
  let emailEnabled = true;
  try {
    const channelsSnap = await db.collection('settings').doc('notificationChannels').get();
    if (channelsSnap.exists && 'moderation_critical' in channelsSnap.data()) {
      emailEnabled = !!channelsSnap.data().moderation_critical.email;
    }
  } catch (e) {}

  if (emailEnabled) {
    const html = `
    <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f7fa;padding:24px;">
      <div style="background:#fff;border-radius:12px;padding:24px;">
        <div style="font-size:20px;font-weight:800;color:#E24B4A;margin-bottom:16px;">🚨 تنبيه أمني — رادار</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:10px;">محاولة نشر محتوى محظور (حرج)</div>
        <div style="font-size:14px;color:#444;line-height:1.8;">
          نوع المحتوى: ${payload.itemType === 'listing' ? 'إعلان' : 'طلب'}<br>
          العنوان: ${payload.title || '—'}<br>
          التصنيف: ${payload.categoryLabel}<br>
          المستخدم: ${payload.userName || payload.userId}
        </div>
        <div style="margin-top:20px;font-size:13px;color:#888;">يرجى مراجعته من لوحة التحكم ← تبويب الفلترة.</div>
      </div>
    </div>`;
    await Promise.all(recipients.map(r =>
      sendMail({ to: r.email, subject: '🚨 تنبيه أمني — محاولة نشر محتوى محظور', html }).catch(e => console.error('notify email error:', e.message))
    ));
  }
}

// ─── يفحص نص الإعلان/الطلب مقابل قائمة الكلمات المحظورة (لا تُكشف للعميل أبداً) قبل النشر الفعلي ───
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    let decoded;
    try { decoded = await verifyAuth(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

    const { text, itemType, itemId, title } = req.body || {};
    if (!text || !itemType || !itemId) return res.status(400).json({ error: 'بيانات غير مكتملة' });
    if (!['listing', 'request'].includes(itemType)) return res.status(400).json({ error: 'itemType غير صالح' });

    const db = admin.firestore();
    const keywordsSnap = await db.collection('moderation').doc('keywords').get();
    const lists = keywordsSnap.exists ? keywordsSnap.data() : {};
    const normalizedText = normalize(text);

    const categories = [
      { key: 'bannedGoods', label: 'سلع ممنوعة', tier: 1 },
      { key: 'politics', label: 'سيادة الدولة / أمر سياسي', tier: 1 },
      { key: 'religion', label: 'الدين', tier: 2 },
    ];

    let matched = null;
    for (const cat of categories) {
      const kw = findMatch(normalizedText, lists[cat.key]);
      if (kw) { matched = { ...cat, keyword: kw }; break; }
    }

    const collectionName = itemType === 'listing' ? 'listings' : 'requests';
    const itemRef = db.collection(collectionName).doc(itemId);

    if (!matched) {
      // محتوى سليم — يُفعَّل الإعلان/الطلب فعلياً الآن
      await itemRef.update({ status: 'active' });
      return res.status(200).json({ violation: false });
    }

    // وُجدت مخالفة — يبقى الإعلان/الطلب بحالة "pending" (غير ظاهر للعامة) ولا نكشف شيئاً لصاحبه
    const userSnap = await db.collection('users').doc(decoded.uid).get();
    const userName = userSnap.exists ? userSnap.data().name : decoded.email;

    await db.collection('moderationLog').add({
      itemType, itemId, title: title || '',
      userId: decoded.uid, userName: userName || '',
      category: matched.key, categoryLabel: matched.label, tier: matched.tier,
      matchedKeyword: matched.keyword,
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const userRef = db.collection('users').doc(decoded.uid);
    await userRef.set({ moderationFlags: admin.firestore.FieldValue.increment(1) }, { merge: true });
    const updatedUserSnap = await userRef.get();
    const flags = updatedUserSnap.data()?.moderationFlags || 0;
    if (flags >= FLAG_THRESHOLD) {
      await userRef.update({ postingRestricted: true });
    }

    if (matched.tier === 1) {
      await notifyAdmins(admin, db, {
        itemType, title, categoryLabel: matched.label,
        userId: decoded.uid, userName
      });
    }

    return res.status(200).json({ violation: true, tier: matched.tier });
  } catch (e) {
    console.error('moderate-content error:', e);
    return res.status(500).json({ error: e.message });
  }
};
