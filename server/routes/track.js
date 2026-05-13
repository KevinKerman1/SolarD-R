const crypto = require('node:crypto');
const analyticsDb = require('../db/analytics');

const IP_SALT = process.env.IP_SALT || 'sdp-default-salt-change-me';
const MAX_BATCH = 50;

const ALLOWED_TYPES = new Set([
  'pageview', 'scroll', 'dwell', 'click', 'outbound',
  'form_field', 'form_submit', 'form_abandon', 'form_validation',
  'engagement',
]);

function log(level, msg, extra) {
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...(extra || {}) }));
}

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(IP_SALT + ip).digest('hex').slice(0, 32);
}

function clipText(s, n) {
  if (s == null) return null;
  s = String(s);
  return s.length > n ? s.slice(0, n) : s;
}

module.exports = async function handleTrack(req, res) {
  // Beacons need 204 fast, even if DB is down.
  res.status(204).end();

  if (!analyticsDb.enabled) return;

  const body = req.body || {};
  const events = Array.isArray(body.events) ? body.events : (Array.isArray(body) ? body : [body]);
  if (events.length === 0) return;

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;
  const ua = req.headers['user-agent'] || null;
  const ipHash = hashIp(ip);

  const rows = [];
  for (const e of events.slice(0, MAX_BATCH)) {
    if (!e || typeof e !== 'object') continue;
    const t = clipText(e.event_type, 32);
    if (!t || !ALLOWED_TYPES.has(t)) continue;
    rows.push([
      clipText(e.session_id, 64),
      clipText(e.anon_id, 64),
      t,
      clipText(e.page_path, 256),
      clipText(e.referrer, 512),
      e.utm && typeof e.utm === 'object' ? e.utm : null,
      e.payload && typeof e.payload === 'object' ? e.payload : null,
      ipHash,
      clipText(ua, 512),
    ]);
  }

  if (rows.length === 0) return;

  try {
    const params = [];
    const placeholders = rows.map((_, i) => {
      const base = i * 9;
      return `($${base+1},$${base+2},$${base+3},$${base+4},$${base+5},$${base+6},$${base+7},$${base+8},$${base+9})`;
    }).join(',');
    for (const r of rows) params.push(...r);
    await analyticsDb.pool.query(
      `INSERT INTO events (session_id, anon_id, event_type, page_path, referrer, utm, payload, ip_hash, user_agent)
       VALUES ${placeholders}`,
      params,
    );
  } catch (err) {
    log('error', 'events-insert-failed', { err: String(err), count: rows.length });
  }
};
