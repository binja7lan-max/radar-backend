const CLOUD_NAME = 'dnldlmiki';

// يستخرج public_id من رابط Cloudinary (مثل https://res.cloudinary.com/dnldlmiki/image/upload/v123/radar/abc.jpg → radar/abc)
function extractPublicId(url) {
  const m = String(url || '').match(/\/upload\/(?:v\d+\/)?(.+?)(?:\.[a-zA-Z0-9]+)?$/);
  return m ? m[1] : null;
}

// حذف صورة واحدة من Cloudinary فعلياً — يتجاهل بصمت أي خطأ (الحذف من القاعدة أهم وأولوية أعلى من هذا)
async function deleteImage(url) {
  const publicId = extractPublicId(url);
  if (!publicId) return;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  if (!apiKey || !apiSecret) return;
  try {
    const auth = Buffer.from(`${apiKey}:${apiSecret}`).toString('base64');
    await fetch(`https://api.cloudinary.com/v1_1/${CLOUD_NAME}/resources/image/upload?public_ids[]=${encodeURIComponent(publicId)}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Basic ${auth}` }
    });
  } catch (e) { console.error('cloudinary delete error:', e.message); }
}

// حذف عدة صور دفعة واحدة (يتجاهل الروابط الفارغة)
async function deleteImages(urls) {
  const list = (urls || []).filter(Boolean);
  await Promise.all(list.map(deleteImage));
}

module.exports = { deleteImage, deleteImages };
