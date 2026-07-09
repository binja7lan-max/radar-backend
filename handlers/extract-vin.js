const { getAdmin } = require('../lib/firebaseAdmin');
const { applyCors } = require('../lib/cors');
const { verifyAuth } = require('../lib/auth');

const IS_NON_PROD = process.env.APP_ENV !== 'production';
const MAX_IMAGE_BYTES = 6 * 1024 * 1024;

function parseImageDataUrl(dataUrl) {
  const match = String(dataUrl || '').match(/^data:(image\/(?:jpeg|jpg|png|webp));base64,([a-z0-9+/=\s]+)$/i);
  if (!match) {
    const e = new Error('صيغة الصورة غير مدعومة');
    e.status = 400;
    throw e;
  }

  const mime = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const base64 = match[2].replace(/\s/g, '');
  const byteLength = Buffer.byteLength(base64, 'base64');
  if (!byteLength || byteLength > MAX_IMAGE_BYTES) {
    const e = new Error('حجم الصورة كبير — الحد الأقصى 6MB');
    e.status = 400;
    throw e;
  }
  return { mime, base64, dataUrl: `data:${mime};base64,${base64}` };
}

function extractVinFromText(text) {
  const raw = String(text || '').toUpperCase();
  const chunks = raw.match(/[A-Z0-9][A-Z0-9\s\-_.:\/]{8,}[A-Z0-9]/g) || [];
  const pools = [raw, ...chunks].map(s => s.replace(/[^A-Z0-9]/g, ''));

  for (const pool of pools) {
    for (let i = 0; i <= pool.length - 17; i++) {
      const candidate = pool.slice(i, i + 17);
      if (/^[A-HJ-NPR-Z0-9]{17}$/.test(candidate)) return candidate;
    }
  }
  return '';
}

async function extractWithGoogleVision(base64) {
  const key = process.env.GOOGLE_VISION_API_KEY;
  if (!key) return null;

  const response = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${encodeURIComponent(key)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [{
        image: { content: base64 },
        features: [{ type: 'DOCUMENT_TEXT_DETECTION', maxResults: 1 }],
        imageContext: { languageHints: ['ar', 'en'] },
      }],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || 'تعذر الاتصال بخدمة Google Vision');
  }

  const result = data?.responses?.[0] || {};
  if (result.error) throw new Error(result.error.message || 'فشل التعرف على الصورة');

  return {
    provider: 'google-vision',
    text: result.fullTextAnnotation?.text || result.textAnnotations?.[0]?.description || '',
  };
}

async function extractWithOpenAI(dataUrl) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return null;

  const model = process.env.OPENAI_OCR_MODEL || 'gpt-4o-mini';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      input: [{
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: 'استخرج رقم الهيكل VIN من صورة استمارة سيارة سعودية. أعد JSON فقط بالشكل {"vin":"...","text":"..."}، وإذا لم يوجد رقم هيكل اجعل vin فارغاً.',
          },
          { type: 'input_image', image_url: dataUrl },
        ],
      }],
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data?.error?.message || 'تعذر الاتصال بخدمة OpenAI OCR');
  }

  const text = data.output_text
    || data.output?.flatMap(o => o.content || []).map(c => c.text || '').join('\n')
    || '';

  return { provider: 'openai', text };
}

module.exports = async (req, res) => {
  if (applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const admin = getAdmin();
    await verifyAuth(req, admin);

    const { mime, base64, dataUrl } = parseImageDataUrl(req.body?.imageDataUrl);

    let extracted = await extractWithGoogleVision(base64);
    if (!extracted) extracted = await extractWithOpenAI(dataUrl);
    if (!extracted) {
      return res.status(501).json({
        error: 'خدمة OCR غير مفعلة. أضف GOOGLE_VISION_API_KEY أو OPENAI_API_KEY في إعدادات الخادم.',
      });
    }

    let vin = extractVinFromText(extracted.text);
    if (!vin && extracted.provider === 'openai') {
      try {
        const parsed = JSON.parse(extracted.text);
        vin = extractVinFromText(parsed.vin || '');
      } catch (_) {}
    }

    return res.status(200).json({
      success: true,
      vin,
      provider: extracted.provider,
      mime,
      ...(IS_NON_PROD ? { rawText: extracted.text.slice(0, 2000) } : {}),
    });
  } catch (e) {
    console.error('[extract-vin]', e.message);
    return res.status(e.status || 500).json({ error: e.message || 'تعذر استخراج رقم الهيكل' });
  }
};
