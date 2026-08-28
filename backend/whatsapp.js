// WhatsApp Cloud API (Meta) notification helper.
// No extra npm packages — uses Node 18+ global fetch.
//
// Required env vars (backend/.env):
//   WHATSAPP_TOKEN     - Meta permanent access token (System User token)
//   WHATSAPP_PHONE_ID  - the business number's Phone Number ID
//   HOST_WHATSAPP      - (host notifications only) host's own WhatsApp in E.164,
//                        e.g. 918123456789
//
// sendWhatsApp(text)            -> sends to the host (HOST_WHATSAPP)
// sendWhatsApp(text, to)        -> sends to any recipient's E.164 number (customer)
//
// Notifications are best-effort: failures are logged, never thrown to the caller.
//
// IMPORTANT (Meta policy): To proactively message a customer who has not messaged
// you first in the last 24h, Meta requires an APPROVED message template created in
// Meta Business Manager. This code sends a plain text message, which works whenever
// there is an open 24h customer-initiated conversation. For reliable proactive
// confirmations, create a template and switch this to type:'template' with the
// component params. See the README deployment notes.

const GRAPH_URL = 'https://graph.facebook.com/v20.0';

// WhatsApp can send once we have a token and a Phone Number ID (the recipient is
// decided per call, so HOST_WHATSAPP is only needed for host notifications).
function isConfigured() {
  return Boolean(
    process.env.WHATSAPP_TOKEN &&
    process.env.WHATSAPP_PHONE_ID
  );
}

// Convert an Indian 10-digit mobile (the site only accepts Indian numbers) to the
// E.164 form the WhatsApp API needs, e.g. '9876543210' -> '919876543210'.
// Returns null when the number is not a valid Indian mobile. Callers can use this
// to decide whether a customer is reachable on WhatsApp.
function indiaE164(phone10) {
  const digits = String(phone10 || '').replace(/\D+/g, '');
  if (!/^[6-9][0-9]{9}$/.test(digits)) return null; // Indian mobile: 6-9 then 9 digits
  return '91' + digits;
}

async function sendWhatsApp(text, to) {
  if (!isConfigured()) {
    console.log('ℹ️  WhatsApp skipped (WHATSAPP_TOKEN/WHATSAPP_PHONE_ID not set).');
    return false;
  }

  const recipient = to || process.env.HOST_WHATSAPP;
  if (!recipient) {
    console.log('ℹ️  WhatsApp skipped (no recipient given and HOST_WHATSAPP not set).');
    return false;
  }

  try {
    const res = await fetch(`${GRAPH_URL}/${process.env.WHATSAPP_PHONE_ID}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { preview_url: false, body: text }
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`⚠️ WhatsApp send to ${recipient} failed (${res.status}): ${errBody}`);
      return false;
    }
    console.log(`✅ WhatsApp message sent to ${recipient}.`);
    return true;
  } catch (err) {
    console.error('⚠️ WhatsApp send failed:', err && err.message || err);
    return false;
  }
}

module.exports = { sendWhatsApp, isConfigured, indiaE164 };
