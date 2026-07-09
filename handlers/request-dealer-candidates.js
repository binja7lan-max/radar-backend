const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { verifyAuth } = require('../lib/auth');

const PAGE_SIZE_DEFAULT = 20;
// TODO: استبدل بـ Algolia/Typesense عندما يتجاوز عدد الموردين 300
const MAX_FETCH = 300;

function normalizeScope(scope) {
  return scope === 'all' ? 'all' : 'city';
}

async function getDealerPhone(db, dealerId) {
  const snap = await db.collection('users').doc(dealerId).collection('private').doc('contact').get();
  return snap.exists ? (snap.data().phone || '') : '';
}

// جلب الموردين وترتيبهم وتصفيتهم — بدون فلتر المدينة في Firestore (التصفية في Node.js)
async function fetchDealerCandidates(db, requestData, scope, requesterId, search, pageSize, offset) {
  const brand = (requestData.brand || '').trim();
  const city  = (requestData.city  || '').trim();

  // جلب بلا فلتر مدينة — نرتّب المدينة في Node.js للحفاظ على pagination سليم
  let q = db.collection('users').where('isDealer', '==', true);
  if (brand) q = q.where('dealerBrands', 'array-contains', brand);
  const snap = await q.limit(MAX_FETCH).get();

  let dealers = snap.docs
    .map(d => ({
      id: d.id,
      name: d.data().name || '',
      city: d.data().city || '',
      verified: !!d.data().verified,
      dealerBrands: Array.isArray(d.data().dealerBrands) ? d.data().dealerBrands : [],
    }))
    .filter(d => d.id !== requesterId);

  // city scope: موردو المدينة أولاً ثم بقية المدن
  if (scope === 'city' && city) {
    const same  = dealers.filter(d => d.city === city);
    const other = dealers.filter(d => d.city !== city);
    dealers = [...same, ...other];
  }

  // بحث بالاسم في Node.js (Firestore لا يدعم contains)
  const searchLower = (search || '').trim().toLowerCase();
  if (searchLower) {
    dealers = dealers.filter(d => d.name.toLowerCase().includes(searchLower));
  }

  const totalMatched = dealers.length;
  const page   = dealers.slice(offset, offset + pageSize);
  const hasMore = (offset + pageSize) < totalMatched;

  // جوالات الصفحة الحالية فقط — يقلّل عمليات القراءة بشكل كبير
  const withPhones = await Promise.all(
    page.map(async d => ({ ...d, phone: await getDealerPhone(db, d.id) }))
  );

  // فقط الموردون الذين لديهم جوال سعودي صحيح
  const candidates = withPhones.filter(d => /^05\d{8}$/.test(d.phone));

  return { candidates, totalMatched, hasMore };
}

async function notifyDealers(db, dealers, requestId, requestData, maxCount) {
  const selected = dealers.slice(0, maxCount);
  if (!selected.length) return 0;
  const batch = db.batch();
  selected.forEach(dealer => {
    const ref = db.collection('notifications').doc();
    batch.set(ref, {
      userId: dealer.id,
      type: 'request',
      title: 'طلب قطع غيار جديد',
      body: requestData.title || 'يوجد طلب جديد مناسب لك',
      data: { requestId, fromName: requestData.requesterName || 'رادار' },
      read: false,
      createdAt: new Date(),
    });
  });
  await batch.commit();
  return selected.length;
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    const decoded = await verifyAuth(req, admin);
    const db = admin.firestore();

    const {
      requestId,
      requestData: rawRequestData = {},
      scope:        rawScope,
      notifyInternal,
      search        = '',
      pageSize:     rawPageSize,
      offset:       rawOffset,
    } = req.body || {};

    if (!requestId) return res.status(400).json({ error: 'requestId مطلوب' });

    const reqSnap = await db.collection('requests').doc(requestId).get();
    if (!reqSnap.exists) return res.status(404).json({ error: 'الطلب غير موجود' });

    const savedRequest = reqSnap.data() || {};
    if (savedRequest.requesterId !== decoded.uid) {
      return res.status(403).json({ error: 'لا يمكنك إرسال طلب لا تملكه' });
    }

    const settingsSnap = await db.collection('settings').doc('general').get();
    const settings = settingsSnap.exists ? settingsSnap.data() : {};
    // maxSelect: يحدد الاختيار/الإشعار فقط — لا يحدد عدد الموردين المعروضين
    const maxSelect = Math.min(20, Math.max(1, parseInt(settings.maxWhatsappSuppliersPerRequest, 10) || 3));

    const requestData = { ...savedRequest, ...rawRequestData };
    const scope    = normalizeScope(rawScope || requestData.whatsappDealerScope);
    const pageSize = Math.min(50, Math.max(5, parseInt(rawPageSize)  || PAGE_SIZE_DEFAULT));
    const offset   = Math.max(0,              parseInt(rawOffset)     || 0);

    const { candidates, totalMatched, hasMore } = await fetchDealerCandidates(
      db, requestData, scope, decoded.uid, search, pageSize, offset
    );

    // الإشعارات الداخلية: مرة واحدة فقط (أول صفحة) — الحد من maxSelect لا من عدد الموردين المعروضين
    const notifiedCount = (notifyInternal && offset === 0)
      ? await notifyDealers(db, candidates, requestId, requestData, maxSelect)
      : 0;

    return res.status(200).json({
      maxSelect,
      dealers:      candidates,
      hasMore,
      totalShown:   totalMatched,
      notifiedCount,
      nextOffset:   offset + pageSize,
    });
  } catch (e) {
    console.error('request-dealer-candidates error:', { code: e.code, message: e.message });
    return res.status(500).json({ error: 'حدث خطأ داخلي' });
  }
};
