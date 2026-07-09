// CORS — يُطبَّق على كل handler بـ: if (applyCors(req, res)) return;
//
// APP_ENV=development → LOCAL_ORIGINS + DEV_ORIGINS (البيئة اليومية)
// APP_ENV=emulator    → LOCAL_ORIGINS فقط
// APP_ENV=production  → PROD_ORIGINS فقط

const PROD_ORIGINS = [
  'https://radarparts.net',
  'https://www.radarparts.net',
  'https://radarparts-5d6f0.web.app',
  'https://radarparts-5d6f0.firebaseapp.com',
];

const DEV_ORIGINS = [
  'https://radar-dev-7387b.web.app',
  'https://radar-dev-7387b.firebaseapp.com',
];

const LOCAL_ORIGINS = [
  'http://127.0.0.1:5500',
  'http://localhost:5500',
  'http://127.0.0.1:5000',
  'http://localhost:5000',
];

function _getAllowedOrigins() {
  const env = process.env.APP_ENV || 'development';
  if (env === 'emulator')    return LOCAL_ORIGINS;
  if (env === 'development') return [...LOCAL_ORIGINS, ...DEV_ORIGINS];
  return PROD_ORIGINS;
}

function applyCors(req, res) {
  const origin = req.headers.origin || '';
  if (_getAllowedOrigins().includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

module.exports = { applyCors };
