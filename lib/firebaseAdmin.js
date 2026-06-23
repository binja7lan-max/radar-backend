

// تهيئة Firebase Admin SDK مرة واحدة فقط (يُعاد استخدامها بين استدعاءات Vercel)
const admin = require('firebase-admin');

function getAdmin() {
  if (!admin.apps.length) {
    const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
  }
  return admin;
}

module.exports = { getAdmin };
