// WhatsApp Cloud API (Meta) notification helper for the host.
// No extra npm packages — uses Node 18+ global fetch.
//
// Required env vars (backend/.env):
//   WHATSAPP_TOKEN     - Meta permanent access token (System User token)
//   WHATSAPP_PHONE_ID  - the business number's Phone Number ID
//   HOST_WHATSAPP      - host's personal WhatsApp in E.164 format, e.g. 918123456789
//
// Notifications are best-effort: failures are logged, never thrown to the caller.

const GRAPH_URL = 'https://graph.facebook.com/v20.0';

function isConfigured() {
  return Boolean(
    process.env.WHATSAPP_TOKEN &&
    process.env.WHATSAPP_PHONE_ID &&
    process.env.HOST_WHATSAPP
  );
}

async function sendWhatsApp(text) {
  if (!isConfigured()) {
    console.log('ℹ️  WhatsApp alerts skipped (WHATSAPP_TOKEN/WHATSAPP_PHONE_ID/HOST_WHATSAPP not set).');
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
        to: process.env.HOST_WHATSAPP,
        type: 'text',
        text: { preview_url: false, body: text }
      })
    });

    if (!res.ok) {
      const errBody = await res.text();
      console.error(`⚠️ WhatsApp send failed (${res.status}): ${errBody}`);
      return false;
    }
    console.log('✅ WhatsApp alert sent to host.');
    return true;
  } catch (err) {
    console.error('⚠️ WhatsApp alert failed:', err && err.message || err);
    return false;
  }
}

module.exports = { sendWhatsApp, isConfigured };
