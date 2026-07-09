const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { getPaypalAccessToken, PAYPAL_API_BASE } = require('../lib/paypal');

// ─── تأكيد (capture) عملية دفع PayPal بعد موافقة العميل ───
module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    const db = admin.firestore();

    const { orderId } = req.body || {};
    if (!orderId || !/^[A-Z0-9]{17}$/.test(orderId)) {
      return res.status(400).json({ error: 'orderId غير صالح' });
    }

    const payRef = db.collection('payments').doc(orderId);
    const paySnap = await payRef.get();
    if (!paySnap.exists) return res.status(404).json({ error: 'عملية الدفع غير موجودة' });

    const payData = paySnap.data();

    // منع double capture
    if (payData.status === 'completed') return res.status(409).json({ error: 'هذه العملية مكتملة مسبقاً' });

    // إذا كان الدفع مرتبطاً بحساب، نتحقق من الملكية
    if (payData.uid) {
      const authHeader = req.headers.authorization || '';
      const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
      if (!idToken) return res.status(401).json({ error: 'يجب تسجيل الدخول' });
      let decoded;
      try { decoded = await admin.auth().verifyIdToken(idToken); }
      catch (e) { return res.status(401).json({ error: 'جلسة غير صالحة، سجّل الدخول مجدداً' }); }
      if (payData.uid !== decoded.uid) return res.status(403).json({ error: 'غير مخوّل' });
    }

    const accessToken = await getPaypalAccessToken();
    const captureRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders/${orderId}/capture`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
    });
    const capture = await captureRes.json();
    if (!captureRes.ok) throw new Error(capture.message || 'فشل تأكيد الدفع');

    const status = capture.status === 'COMPLETED' ? 'completed' : String(capture.status || 'unknown').toLowerCase();
    const captureId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.id || null;

    await payRef.update({
      status,
      paypalCaptureId: captureId,
      capturedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({ success: status === 'completed', status });
  } catch (e) {
    console.error('paypal-capture-order error:', e);
    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
};
