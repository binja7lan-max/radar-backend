const HANDLERS = {
  'add-changelog-entry': '../handlers/add-changelog-entry',
  'check-expiring': '../handlers/check-expiring',
  'create-user': '../handlers/create-user',
  'delete-user': '../handlers/delete-user',
  'extract-vin': '../handlers/extract-vin',
  'lookup-email-by-phone': '../handlers/lookup-email-by-phone',
  'migrate-emails-private': '../handlers/migrate-emails-private',
  'moderate-content': '../handlers/moderate-content',
  'notify-matching-dealers': '../handlers/notify-matching-dealers',
  'paypal-capture-order': '../handlers/paypal-capture-order',
  'paypal-create-order': '../handlers/paypal-create-order',
  'recompute-rating': '../handlers/recompute-rating',
  'record-commission-payment': '../handlers/record-commission-payment',
  'request-dealer-candidates': '../handlers/request-dealer-candidates',
  'send-email': '../handlers/send-email',
  'send-push': '../handlers/send-push',
  'set-claims': '../handlers/set-claims',
  'update-my-phone': '../handlers/update-my-phone',
  'update-user-contact': '../handlers/update-user-contact',
  'wa-job-status': '../handlers/wa-job-status',
  'wa-send': '../handlers/wa-send',
  'wa-session': '../handlers/wa-session',
  'whatsapp-session': '../handlers/whatsapp-session',
};

function resolveHandlerName(req) {
  const raw = req.query?.path;
  if (Array.isArray(raw)) return raw[0];
  if (typeof raw === 'string' && raw) return raw.split('/')[0];

  const pathname = (req.url || '').split('?')[0].replace(/^\/api\/?/, '');
  return pathname.split('/')[0];
}

module.exports = async (req, res) => {
  const name = resolveHandlerName(req);
  const handlerPath = HANDLERS[name];

  if (!handlerPath) {
    return res.status(404).json({ error: 'Not found', path: `/api/${name || ''}` });
  }

  const handler = require(handlerPath);
  return handler(req, res);
};
