# رادار — الباك إند (Vercel)

دوال خلفية تستبدل Firebase Cloud Functions (التي تعثّر نشرها بسبب متطلبات خطة Blaze والسجل التجاري). تعمل على Vercel مجاناً بالكامل، بدون بطاقة ائتمان أو سجل تجاري.

## الوظائف
- `api/send-push.js` — إرسال إشعار Push لمستخدم واحد (يُستدعى من المتصفح بعد كتابة كل إشعار داخلي).
- `api/send-push-bulk.js` — إرسال Push لعدة مستخدمين (الإشعارات الجماعية من لوحة الأدمن).
- `api/create-user.js` — إنشاء حساب مستخدم جديد بالكامل (تسجيل دخول حقيقي) — سوبر أدمن فقط.

## خطوات النشر (مرة واحدة فقط)

### 1) الحصول على مفتاح Firebase Admin
1. افتح [Firebase Console](https://console.firebase.google.com) → اختر مشروع `radarparts-5d6f0`.
2. ⚙️ إعدادات المشروع → تبويب **Service accounts**.
3. اضغط **Generate new private key** → سيُنزَّل ملف JSON. **احتفظ به بسرية تامة — لا ترفعه إلى GitHub أبداً.**

### 2) رفع هذا المجلد إلى GitHub
1. أنشئ مستودع (Repository) جديد على GitHub (خاص أو عام، لا فرق) — مثلاً باسم `radar-backend`.
2. داخل المستودع: **Add file → Upload files** → اسحب كل ملفات هذا المجلد (`vercel-backend/`) بداخله (محتوى المجلد فقط، وليس المجلد نفسه — أي `api/`, `lib/`, `package.json`, `.gitignore` تكون في جذر المستودع).
3. Commit.

### 3) ربط المستودع بـ Vercel
1. افتح [vercel.com](https://vercel.com) → سجّل دخول بحساب GitHub (لا حاجة لبطاقة ائتمان للخطة المجانية).
2. **Add New → Project** → اختر مستودع `radar-backend` الذي رفعته.
3. قبل الضغط على Deploy: افتح **Environment Variables** وأضف متغيراً باسم:
   - **Key**: `FIREBASE_SERVICE_ACCOUNT_KEY`
   - **Value**: افتح ملف JSON الذي نزّلته في الخطوة 1، والصق **محتواه كاملاً** (كنص JSON واحد) في هذا الحقل.
4. اضغط **Deploy**.
5. بعد انتهاء النشر، ستحصل على رابط مثل: `https://radar-backend.vercel.app`

### 4) أرسل لي الرابط
أعطني الرابط النهائي وسأحدّث الكود في الموقع (`js/notifications.js` و `js/admin.js`) ليستخدمه فعلياً.

## ملاحظة أمان
مفتاح `FIREBASE_SERVICE_ACCOUNT_KEY` يعطي صلاحية كاملة على المشروع. هو محفوظ فقط كمتغير بيئة سري داخل Vercel (لا يظهر في الكود ولا في المتصفح) — هذا هو التصميم الصحيح والآمن.
