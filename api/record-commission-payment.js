const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');

// ─── تسجيل دفعة عمولة عبر التحويل البنكي (بإرفاق إثبات) — تبقى "قيد المراجعة" حتى يعتمدها الأدمن ───
// يعمل لمستخدم مسجّل دخوله (يُربط بحسابه تلقائياً) أو لزائر غير مسجّل (يُطلب رقم جواله):
// - إذا تطابق رقم الجوال مع مستخدم موجود: تُربط الدفعة بحسابه (يظهر له في سجله لاحقاً عند تسجيل الدخول)
// - إذا لم يتطابق: تُسجَّل للأدمن فقط، موضّحاً أنها لمستخدم غير معروف
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    const db = admin.firestore();

    const { amountSAR, proofImageUrl, phone } = req.body || {};
    const amount = parseFloat(amountSAR);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'قيمة البيع غير صحيحة' });
    if (!proofImageUrl) return res.status(400).json({ error: 'إثبات التحويل مطلوب' });

    // تسجيل دخول اختياري — لا نرفض الطلب إذا لم يكن المستخدم مسجّلاً، لكن نتحقق من التوكن إن وُجد
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    let decoded = null;
    if (idToken) {
      try { decoded = await admin.auth().verifyIdToken(idToken); }
      catch (e) { return res.status(401).json({ error: 'جلسة غير صالحة، سجّل الدخول مجدداً' }); }
    }

    let userId = null, userName = null, finalPhone = phone || null, matchedExistingUser = false;

    if (decoded) {
      userId = decoded.uid;
      matchedExistingUser = true;
      const userSnap = await db.collection('users').doc(decoded.uid).get();
      userName = userSnap.exists ? (userSnap.data().name || null) : null;
      finalPhone = userSnap.exists ? (userSnap.data().phone || null) : null;
    } else {
      if (!phone || !/^05\d{8}$/.test(phone)) {
        return res.status(400).json({ error: 'أدخل رقم جوال صحيح (10 خانات يبدأ بـ 05)' });
      }
      const phoneSnap = await db.collection('users').where('phone', '==', phone).limit(1).get();
      if (!phoneSnap.empty) {
        userId = phoneSnap.docs[0].id;
        userName = phoneSnap.docs[0].data().name || null;
        matchedExistingUser = true;
      }
    }

    const commissionAmount = Math.round(amount * 0.01 * 100) / 100;

    const docRef = await db.collection('commissionPayments').add({
      amountSAR: amount,
      commissionAmount,
      proofImageUrl,
      userId, userName, phone: finalPhone,
      matchedExistingUser,
      status: 'pending',
      reviewedBy: null, reviewedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ success: true, id: docRef.id });
  } catch (e) {
    console.error('record-commission-payment error:', e);
    return res.status(500).json({ error: e.message });
  }
};
