

// يسمح لموقع رادار (وأي مصدر آخر) باستدعاء هذه الدوال من المتصفح
function applyCors(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true; // الطلب تم التعامل معه (preflight) — على المستدعي إيقاف التنفيذ
  }
  return false;
}

module.exports = { applyCors };
