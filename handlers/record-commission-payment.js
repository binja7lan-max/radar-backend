const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');

// ─── تسجيل دفعة عمولة عبر التحويل البنكي، أو إرفاق/تحديث إثبات تحويل لدفعة مسجَّلة مسبقاً ───
// التسجيل لا يتطلب إثبات تحويل إلزامياً — يمكن إرفاقه فوراً أو لاحقاً من "مدفوعاتي" (لذا دُمج المساران بنفس الملف)
// المسار الأول (بلا paymentId): تسجيل دفعة جديدة. المسار الثاني (مع paymentId): إرفاق إثبات لدفعة موجودة.
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    const db = admin.firestore();
    const { paymentId } = req.body || {};

    // ─── إرفاق/تحديث إثبات تحويل لدفعة موجودة مسبقاً — يتطلب تسجيل دخول، ومالك الدفعة نفسه فقط ───
    if (paymentId) {
      const { proofImageUrl } = req.body || {};
      if (!proofImageUrl) return res.status(400).json({ error: 'رابط الإثبات مطلوب' });

      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!idToken) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
      let decoded;
      try { decoded = await admin.auth().verifyIdToken(idToken); }
      catch (e) { return res.status(401).json({ error: 'جلسة غير صالحة، سجّل الدخول مجدداً' }); }

      const payRef = db.collection('commissionPayments').doc(paymentId);
      const paySnap = await payRef.get();
      if (!paySnap.exists) return res.status(404).json({ error: 'الدفعة غير موجودة' });
      if (paySnap.data().userId !== decoded.uid) return res.status(403).json({ error: 'غير مخوّل' });

      await payRef.update({ proofImageUrl, hasProof: true });
      return res.status(200).json({ success: true });
    }

    // ─── تسجيل دفعة جديدة ───
    const { amountSAR, proofImageUrl, phone } = req.body || {};
    const amount = parseFloat(amountSAR);
    if (!amount || amount <= 0) return res.status(400).json({ error: 'قيمة البيع غير صحيحة' });

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
      proofImageUrl: proofImageUrl || null,
      hasProof: !!proofImageUrl,
      userId, userName, phone: finalPhone,
      matchedExistingUser,
      status: 'pending',
      reviewedBy: null, reviewedAt: null,
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ success: true, id: docRef.id });
  } catch (e) {
    console.error('record-commission-payment error:', e);
    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
};
