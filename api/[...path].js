const HANDLERS = {
  'add-changelog-entry': () => require('../handlers/add-changelog-entry'),
  'check-expiring': () => require('../handlers/check-expiring'),
  'create-user': () => require('../handlers/create-user'),
  'delete-user': () => require('../handlers/delete-user'),
  'extract-vin': () => require('../handlers/extract-vin'),
  'lookup-email-by-phone': () => require('../handlers/lookup-email-by-phone'),
  'migrate-emails-private': () => require('../handlers/migrate-emails-private'),
  'moderate-content': () => require('../handlers/moderate-content'),
  'notify-matching-dealers': () => require('../handlers/notify-matching-dealers'),
  'paypal-capture-order': () => require('../handlers/paypal-capture-order'),
  'paypal-create-order': () => require('../handlers/paypal-create-order'),
  'recompute-rating': () => require('../handlers/recompute-rating'),
  'record-commission-payment': () => require('../handlers/record-commission-payment'),
  'request-dealer-candidates': () => require('../handlers/request-dealer-candidates'),
  'send-email': () => require('../handlers/send-email'),
  'send-push': () => require('../handlers/send-push'),
  'set-claims': () => require('../handlers/set-claims'),
  'update-my-phone': () => require('../handlers/update-my-phone'),
  'update-user-contact': () => require('../handlers/update-user-contact'),
  'wa-job-status': () => require('../handlers/wa-job-status'),
  'wa-send': () => require('../handlers/wa-send'),
  'wa-session': () => require('../handlers/wa-session'),
  'whatsapp-session': () => require('../handlers/whatsapp-session'),
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
  const loadHandler = HANDLERS[name];

  if (!loadHandler) {
    return res.status(404).json({ error: 'Not found', path: `/api/${name || ''}` });
  }

  const handler = loadHandler();
  return handler(req, res);
};
