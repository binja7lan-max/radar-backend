const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { verifyAuth } = require('../lib/auth');
const { sendMail } = require('../lib/mailer');

const SUPER_ADMIN_EMAIL = 'binja7lan@gmail.com';
const FLAG_THRESHOLD = 3; // عدد المخالفات قبل تقييد الحساب من النشر تلقائياً

const CATEGORY_LABELS = { religion: 'الدين', politics: 'سيادة الدولة / أمر سياسي', bannedGoods: 'سلع ممنوعة' };
const SEVERITY_LABELS = { high: 'عالي', medium: 'متوسط', low: 'منخفض' };

// أرقام شائعة الاستخدام للتحايل على الفلترة (Arabizi) → الحرف الذي تمثّله
const LEET_MAP = { '7': 'ح', '3': 'ع', '5': 'خ', '8': 'غ', '2': 'ء', '6': 'ط' };

// يطبّع النص لإزالة أكثر طرق التحايل شيوعاً قبل المطابقة: تشكيل، تطويل، رموز، مسافات، همزات، أرقام بديلة، تكرار حروف
function normalize(text) {
  if (!text) return '';
  let s = String(text);
  s = s.replace(/[ً-ٰٟۖ-ۭ]/g, ''); // التشكيل
  s = s.replace(/ـ/g, ''); // التطويل (الكشيدة)
  s = s.replace(/[إأآا]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه'); // توحيد الهمزات/الألف/التاء المربوطة
  s = s.replace(/[0-9]/g, d => LEET_MAP[d] || d); // أرقام تحايل شائعة
  s = s.toLowerCase();
  s = s.replace(/[^ء-ي٠-٩a-z]/g, ''); // إزالة كل الرموز/المسافات/علامات الترقيم — يبقي الحروف فقط
  s = s.replace(/(.)\1+/g, '$1'); // طيّ أي حرف مكرر متتالٍ (تحايل بتكرار الحروف: خاااص → خاص)
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
  const severityKey = `moderation_${payload.severity}`; // moderation_high | moderation_medium | moderation_low

  let channels = { inapp: true, email: true }; // افتراضياً مفعّلة حتى يضبطها السوبر أدمن
  try {
    const channelsSnap = await db.collection('settings').doc('notificationChannels').get();
    if (channelsSnap.exists && channelsSnap.data()[severityKey]) {
      channels = channelsSnap.data()[severityKey];
    }
  } catch (e) {}

  if (!channels.inapp && !channels.email) return;

  // المستلمون: السوبر أدمن + كل حساب أدمن مفعّل لديه صلاحية "الفلترة" في مصفوفة الصلاحيات
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

  const itemLabel = payload.itemType === 'listing' ? 'إعلان' : payload.itemType === 'request' ? 'طلب' : 'رسالة';

  if (channels.inapp) {
    await Promise.all(recipients.map(r => db.collection('notifications').add({
      userId: r.uid, type: 'system',
      title: `🚨 محاولة نشر محتوى محظور (${SEVERITY_LABELS[payload.severity]})`,
      body: `${itemLabel} ${payload.title ? '"' + payload.title + '"' : ''} — ${payload.categoryLabel}`,
      data: { fromName: 'رادار' }, read: false,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    }).catch(e => console.error('notify in-app error:', e.message))));
  }

  if (channels.email) {
    const html = `
    <div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;max-width:480px;margin:0 auto;background:#f5f7fa;padding:24px;">
      <div style="background:#fff;border-radius:12px;padding:24px;">
        <div style="font-size:20px;font-weight:800;color:#E24B4A;margin-bottom:16px;">🚨 تنبيه أمني — رادار</div>
        <div style="font-size:15px;font-weight:700;margin-bottom:10px;">محاولة نشر محتوى محظور (درجة الخطورة: ${SEVERITY_LABELS[payload.severity]})</div>
        <div style="font-size:14px;color:#444;line-height:1.8;">
          نوع المحتوى: ${itemLabel}<br>
          ${payload.title ? `العنوان: ${payload.title}<br>` : ''}
          التصنيف: ${payload.categoryLabel}<br>
          المستخدم: ${payload.userName || payload.userId}
        </div>
        <div style="margin-top:20px;font-size:13px;color:#888;">يرجى مراجعته من لوحة التحكم ← تبويب الفلترة.</div>
      </div>
    </div>`;
    await Promise.all(recipients.map(r =>
      sendMail({ to: r.email, subject: `🚨 تنبيه أمني — محاولة نشر محتوى محظور (${SEVERITY_LABELS[payload.severity]})`, html }).catch(e => console.error('notify email error:', e.message))
    ));
  }
}

// ─── يفحص نص الإعلان/الطلب/الرسالة مقابل قائمة الكلمات المحظورة (لا تُكشف للعميل أبداً) ───
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    let decoded;
    try { decoded = await verifyAuth(req, admin); } catch (e) { return res.status(e.status || 401).json({ error: e.message }); }

    const { text, itemType, itemId, title, convId } = req.body || {};
    if (!text || !itemType || !itemId) return res.status(400).json({ error: 'بيانات غير مكتملة' });
    if (!['listing', 'request', 'message'].includes(itemType)) return res.status(400).json({ error: 'itemType غير صالح' });
    if (itemType === 'message' && !convId) return res.status(400).json({ error: 'convId مطلوب للرسائل' });

    const db = admin.firestore();
    const keywordsSnap = await db.collection('moderation').doc('keywords').get();
    const lists = keywordsSnap.exists ? keywordsSnap.data() : {};
    const normalizedText = normalize(text);

    let matched = null;
    for (const key of Object.keys(CATEGORY_LABELS)) {
      const catConfig = lists[key] || {};
      const kw = findMatch(normalizedText, catConfig.words);
      if (kw) {
        matched = { key, label: CATEGORY_LABELS[key], severity: catConfig.severity || 'medium', keyword: kw };
        break;
      }
    }

    let itemRef;
    if (itemType === 'message') {
      itemRef = db.collection('conversations').doc(convId).collection('messages').doc(itemId);
    } else {
      itemRef = db.collection(itemType === 'listing' ? 'listings' : 'requests').doc(itemId);
    }

    if (!matched) {
      // محتوى سليم — يُفعَّل الإعلان/الطلب الآن (الرسالة كانت ظاهرة بالفعل، لا حاجة لأي إجراء)
      if (itemType !== 'message') await itemRef.update({ status: 'active' });
      return res.status(200).json({ violation: false });
    }

    const userSnap = await db.collection('users').doc(decoded.uid).get();
    const userName = userSnap.exists ? userSnap.data().name : decoded.email;

    if (itemType === 'message') {
      // الرسالة كانت قد ظهرت فوراً للطرف الآخر — تُحذف الآن بعد اكتشاف المخالفة
      await itemRef.delete().catch(() => {});
    }
    // الإعلان/الطلب يبقى بحالة "pending" (غير ظاهر للعامة) دون أي إجراء إضافي هنا

    await db.collection('moderationLog').add({
      itemType, itemId, convId: convId || null, title: title || '',
      userId: decoded.uid, userName: userName || '',
      category: matched.key, categoryLabel: matched.label, severity: matched.severity,
      matchedKeyword: matched.keyword,
      status: itemType === 'message' ? 'removed' : 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    const userRef = db.collection('users').doc(decoded.uid);
    await userRef.set({ moderationFlags: admin.firestore.FieldValue.increment(1) }, { merge: true });
    const updatedUserSnap = await userRef.get();
    const flags = updatedUserSnap.data()?.moderationFlags || 0;
    if (flags >= FLAG_THRESHOLD) {
      await userRef.update({ postingRestricted: true });
    }

    await notifyAdmins(admin, db, {
      itemType, title, categoryLabel: matched.label, severity: matched.severity,
      userId: decoded.uid, userName
    });

    return res.status(200).json({ violation: true, severity: matched.severity });
  } catch (e) {
    console.error('moderate-content error:', e);
    return res.status(500).json({ error: e.message });
  }
};
