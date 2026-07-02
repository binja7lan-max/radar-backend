// v8.34 — دُمج المسارَين (create + capture) في ملف واحد للبقاء ضمن حد Vercel المجاني (12 دالة)
const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { getPaypalAccessToken, PAYPAL_API_BASE } = require('../lib/paypal');

const SAR_TO_USD = 3.75;
const GUEST_RATE_LIMIT = 5;
const WINDOW_MS = 60 * 1000;

async function checkGuestRateLimit(db, ip) {
  const key = 'paypal_create_' + ip.replace(/[.:]/g, '_');
  const ref = db.collection('rateLimits').doc(key);
  const snap = await ref.get();
  const now = Date.now();
  if (snap.exists) {
    const { count, windowStart } = snap.data();
    if (now - windowStart < WINDOW_MS) {
      if (count >= GUEST_RATE_LIMIT) return false;
      await ref.update({ count: count + 1 });
    } else {
      await ref.set({ count: 1, windowStart: now });
    }
  } else {
    await ref.set({ count: 1, windowStart: now });
  }
  return true;
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    const db = admin.firestore();
    const { action } = req.body || {};

    // ─── capture ───
    if (action === 'capture') {
      const { orderId } = req.body;
      if (!orderId) return res.status(400).json({ error: 'orderId مطلوب' });
      const payRef = db.collection('payments').doc(orderId);
      const paySnap = await payRef.get();
      if (!paySnap.exists) return res.status(404).json({ error: 'عملية الدفع غير موجودة' });
      const payData = paySnap.data();
      if (payData.status === 'completed') return res.status(409).json({ error: 'هذه العملية مكتملة مسبقاً' });
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
      await payRef.update({ status, paypalCaptureId: captureId, capturedAt: admin.firestore.FieldValue.serverTimestamp() });
      return res.status(200).json({ success: status === 'completed', status });
    }

    // ─── create (default) ───
    const authHeader = req.headers.authorization || '';
    const idToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    let decoded = null;
    if (idToken) {
      try { decoded = await admin.auth().verifyIdToken(idToken); }
      catch (e) { return res.status(401).json({ error: 'جلسة غير صالحة، سجّل الدخول مجدداً' }); }
    } else {
      const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 'unknown';
      let allowed = true;
      try { allowed = await checkGuestRateLimit(db, ip); } catch (e) {}
      if (!allowed) return res.status(429).json({ error: 'محاولات كثيرة، انتظر دقيقة ثم أعد المحاولة' });
    }
    const { amountSAR, name, phone } = req.body || {};
    const sar = parseFloat(amountSAR);
    if (!sar || sar <= 0) return res.status(400).json({ error: 'قيمة المبلغ غير صحيحة' });
    if (!name) return res.status(400).json({ error: 'الاسم مطلوب' });
    if (!decoded && (!phone || !/^05\d{8}$/.test(phone))) {
      return res.status(400).json({ error: 'رقم الجوال مطلوب لغير المسجّلين' });
    }
    const usd = Math.round((sar / SAR_TO_USD) * 100) / 100;
    const accessToken = await getPaypalAccessToken();
    const orderRes = await fetch(`${PAYPAL_API_BASE}/v2/checkout/orders`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{ amount: { currency_code: 'USD', value: usd.toFixed(2) }, description: `عمولة رادار (${sar} ريال سعودي)` }]
      })
    });
    const order = await orderRes.json();
    if (!orderRes.ok) throw new Error(order.message || 'فشل إنشاء عملية الدفع');
    await db.collection('payments').doc(order.id).set({
      paypalOrderId: order.id, uid: decoded ? decoded.uid : null,
      name, phone: phone || null, amountSAR: sar, amountUSD: usd,
      status: 'created', createdAt: admin.firestore.FieldValue.serverTimestamp()
    });
    return res.status(200).json({ orderId: order.id });
  } catch (e) {
    console.error('paypal error:', e);
    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
};
