// ─── Validators لـ create-user — نفس المنطق في local و production ─────────

// تطبيع رقم الجوال السعودي:
//   9 خانات تبدأ بـ 5 (صيغة Excel الرقمية) → أضف الصفر → 10 خانات
//   10 خانات تبدأ بـ 05                     → اقبل كما هو
//   فارغ / غير ذلك                          → أعد كما هو (validateCreateUserInput ترفضه إن كان خاطئاً)
function normalizeSaudiPhone(raw) {
  if (raw === null || raw === undefined || raw === 0 || raw === '') return '';
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return '';
  if (/^5\d{8}$/.test(digits)) return '0' + digits;
  return digits;
}

function normalizeEmail(raw) {
  return String(raw || '').trim().toLowerCase();
}

// يُعيد { ok: true, normalized: {...} } أو { ok: false, status, error }
function validateCreateUserInput(body) {
  let { name, email, password, phone, city, isDealer, dealerBrands, verified } = body || {};

  name     = String(name     || '').trim();
  email    = normalizeEmail(email);
  password = String(password || '');
  city     = String(city     || '').trim() || 'الرياض';
  isDealer    = !!isDealer;
  dealerBrands = Array.isArray(dealerBrands) ? dealerBrands : [];
  verified    = !!verified;

  if (!name)     return { ok: false, status: 400, error: 'الاسم مطلوب' };
  if (!email)    return { ok: false, status: 400, error: 'البريد الإلكتروني مطلوب' };
  if (!password) return { ok: false, status: 400, error: 'كلمة المرور مطلوبة' };

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, status: 400, error: 'البريد الإلكتروني غير صحيح' };
  }

  if (password.length < 8 || !/\d/.test(password)) {
    return { ok: false, status: 400, error: 'كلمة المرور 8 أحرف على الأقل وتحتوي على رقم واحد على الأقل' };
  }

  // الجوال اختياري — إذا أُرسل يجب أن يكون 10 خانات يبدأ بـ 05 (أو 9 تبدأ بـ 5 قبل التطبيع)
  let normalizedPhone = '';
  if (phone !== null && phone !== undefined && phone !== 0 && phone !== '') {
    normalizedPhone = normalizeSaudiPhone(phone);
    if (normalizedPhone && !/^05\d{8}$/.test(normalizedPhone)) {
      return {
        ok: false, status: 400,
        error: 'رقم الجوال غير صحيح — يجب أن يكون 10 خانات ويبدأ بـ 05 أو 9 خانات ويبدأ بـ 5',
      };
    }
  }

  return {
    ok: true,
    normalized: { name, email, password, phone: normalizedPhone, city, isDealer, dealerBrands, verified },
  };
}

// أخطاء Firebase Auth المعروفة → رسائل عربية واضحة
const _AUTH_ERROR_MAP = {
  'auth/invalid-email':               'البريد الإلكتروني غير صحيح',
  'auth/email-already-exists':        'هذا البريد مستخدم مسبقاً',
  'auth/invalid-password':            'كلمة المرور غير مقبولة',
  'auth/weak-password':               'كلمة المرور ضعيفة — استخدم 8 أحرف على الأقل مع رقم',
  'auth/invalid-display-name':        'الاسم غير صحيح',
  'auth/phone-number-already-exists': 'رقم الجوال مستخدم مسبقاً',
};

function firebaseAuthErrorMsg(e) {
  return _AUTH_ERROR_MAP[e.code] || null;
}

module.exports = { normalizeSaudiPhone, normalizeEmail, validateCreateUserInput, firebaseAuthErrorMsg };
