// API de conversiones de Meta: recibe cada evento del navegador y lo reenvía
// desde el servidor con el mismo event_id, para que Meta lo deduplique.
// Variables en Vercel (Settings → Environment Variables):
//   META_PIXEL_ID, META_CAPI_TOKEN y, solo mientras pruebas, META_TEST_EVENT_CODE.
// El token nunca va en el código ni en GitHub.

const ALLOWED_EVENTS = ['PageView', 'ViewContent', 'ClickComprar'];
const GRAPH_VERSION = 'v23.0';

function parseCookies(header) {
  return Object.fromEntries(
    (header || '').split(';').filter(Boolean).map(c => {
      const i = c.indexOf('=');
      return [c.slice(0, i).trim(), decodeURIComponent(c.slice(i + 1))];
    })
  );
}

// Si el visitante llega desde un anuncio, la URL trae ?fbclid=...; la cookie _fbc
// puede no existir aún en la primera visita, así que la construimos a partir de él.
function fbcFromUrl(url) {
  try {
    const fbclid = new URL(url).searchParams.get('fbclid');
    return fbclid ? `fb.1.${Date.now()}.${fbclid}` : undefined;
  } catch {
    return undefined;
  }
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // Solo aceptamos llamadas desde la propia web.
  const origin = req.headers.origin;
  if (origin && new URL(origin).host !== req.headers.host) {
    return res.status(403).json({ error: 'origen no permitido' });
  }

  const { event_name, event_id, event_source_url } = req.body || {};
  if (!ALLOWED_EVENTS.includes(event_name) || !event_id) {
    return res.status(400).json({ error: 'evento no permitido' });
  }

  const { META_PIXEL_ID, META_CAPI_TOKEN, META_TEST_EVENT_CODE } = process.env;
  if (!META_PIXEL_ID || !META_CAPI_TOKEN) {
    console.error('Faltan META_PIXEL_ID o META_CAPI_TOKEN en las variables de entorno de Vercel');
    return res.status(503).json({ error: 'API de conversiones sin configurar' });
  }

  const cookies = parseCookies(req.headers.cookie);
  const payload = {
    data: [{
      event_name,
      event_id,
      event_source_url,
      event_time: Math.floor(Date.now() / 1000),
      action_source: 'website',
      user_data: {
        client_ip_address: (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || undefined,
        client_user_agent: req.headers['user-agent'],
        fbp: cookies._fbp,
        fbc: cookies._fbc || fbcFromUrl(event_source_url)
      }
    }]
  };
  if (META_TEST_EVENT_CODE) payload.test_event_code = META_TEST_EVENT_CODE;

  try {
    const r = await fetch(
      `https://graph.facebook.com/${GRAPH_VERSION}/${META_PIXEL_ID}/events?access_token=${encodeURIComponent(META_CAPI_TOKEN)}`,
      { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }
    );
    const body = await r.json();
    if (!r.ok) console.error('Meta respondió con error:', JSON.stringify(body));
    return res.status(r.ok ? 200 : 502).json({ ok: r.ok });
  } catch (err) {
    console.error('No se pudo contactar con Meta:', err);
    return res.status(502).json({ ok: false });
  }
};
