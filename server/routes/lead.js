const crypto = require('node:crypto');
const leadsDb = require('../db/leads');
const { scoreSubmission, rateLimitCheck } = require('../spam');

const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET || null;
const GHL_WEBHOOK_URL  = process.env.GHL_WEBHOOK_URL;
const MIN_SCORE        = parseFloat(process.env.MIN_RECAPTCHA_SCORE || process.env.MIN_SCORE || '0.3');
const MIN_FORM_MS      = 3000;
const IP_SALT          = process.env.IP_SALT || 'sdp-default-salt-change-me';

function log(level, msg, extra) {
  console.log(JSON.stringify({ t: new Date().toISOString(), level, msg, ...(extra || {}) }));
}

function hashIp(ip) {
  if (!ip) return null;
  return crypto.createHash('sha256').update(IP_SALT + ip).digest('hex').slice(0, 32);
}

async function verifyRecaptcha(token, ip) {
  // Soft-optional: if no secret configured OR no token submitted, return neutral pass.
  if (!RECAPTCHA_SECRET) return { ok: true, skipped: 'no-secret' };
  if (!token)             return { ok: true, skipped: 'no-token' };
  const params = new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token });
  if (ip) params.set('remoteip', ip);
  try {
    const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    });
    const j = await r.json();
    if (!j.success)                              return { ok: true, score: null, soft: 'verify-failed' };
    if (typeof j.score === 'number' && j.score < MIN_SCORE) {
      return { ok: true, score: j.score, soft: 'low-score' };
    }
    return { ok: true, score: j.score };
  } catch (e) {
    return { ok: true, soft: 'verify-error' };
  }
}

async function insertLead(row) {
  if (!leadsDb.enabled) return { ok: false, reason: 'db-disabled' };
  try {
    const r = await leadsDb.pool.query(
      `INSERT INTO leads (
        name, phone, email, service, message,
        source_page, referrer,
        utm_source, utm_medium, utm_campaign, utm_term, utm_content,
        ga_client_id, session_id, anon_id,
        recaptcha_score, spam_score, spam_reasons, flagged,
        ip_hash, user_agent, raw
      ) VALUES (
        $1,$2,$3,$4,$5, $6,$7, $8,$9,$10,$11,$12,
        $13,$14,$15, $16,$17,$18,$19, $20,$21,$22
      ) RETURNING id`,
      [
        row.name, row.phone, row.email, row.service, row.message,
        row.source_page, row.referrer,
        row.utm_source, row.utm_medium, row.utm_campaign, row.utm_term, row.utm_content,
        row.ga_client_id, row.session_id, row.anon_id,
        row.recaptcha_score, row.spam_score, JSON.stringify(row.spam_reasons || []), row.flagged,
        row.ip_hash, row.user_agent, row.raw,
      ],
    );
    return { ok: true, id: r.rows[0].id };
  } catch (e) {
    return { ok: false, reason: 'db-error', detail: String(e) };
  }
}

async function forwardGhl(payload) {
  if (!GHL_WEBHOOK_URL) return { ok: false, status: 0, reason: 'no-webhook' };
  try {
    const r = await fetch(GHL_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    return { ok: r.ok, status: r.status };
  } catch (e) {
    return { ok: false, status: 0, reason: String(e) };
  }
}

async function markGhlStatus(id, status) {
  if (!id || !leadsDb.enabled) return;
  try {
    await leadsDb.pool.query(
      `UPDATE leads SET ghl_forwarded = $1, ghl_status = $2 WHERE id = $3`,
      [status >= 200 && status < 300, status, id],
    );
  } catch (e) {
    log('warn', 'leads-update-failed', { id, err: String(e) });
  }
}

module.exports = async function handleLead(req, res) {
  const body = req.body || {};
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || null;

  // 1. Honeypot — silent 200
  if (body.website && String(body.website).trim() !== '') {
    log('info', 'honeypot-tripped', { ip });
    return res.status(200).json({ ok: true });
  }

  // 2. Timing — silent 200
  const loadedAt = parseInt(body.form_loaded_at || '0', 10);
  if (loadedAt > 0 && Date.now() - loadedAt < MIN_FORM_MS) {
    log('info', 'timing-tripped', { ip, elapsed: Date.now() - loadedAt });
    return res.status(200).json({ ok: true });
  }

  // 3. Rate limit per IP — silent 200 (bot can't tell it was throttled)
  const rl = rateLimitCheck(hashIp(ip));
  if (!rl.ok) {
    log('warn', 'rate-limited', { ip, count: rl.count, max: rl.max });
    return res.status(200).json({ ok: true });
  }

  // 4. Spam score — hard reject at 5+, silent 200
  const spam = scoreSubmission(body);
  if (spam.isReject) {
    log('warn', 'spam-rejected', { ip, score: spam.score, reasons: spam.reasons });
    return res.status(200).json({ ok: true });
  }

  // 5. reCAPTCHA — now a SOFT signal. Logged but never blocks.
  const captcha = await verifyRecaptcha(body.recaptcha_token, ip);

  // 6. Build canonical lead row
  const row = {
    name:          body.name || null,
    phone:         body.phone || null,
    email:         body.email || null,
    service:       body.service || null,
    message:       body.message || null,
    source_page:   body.source_page || req.headers.referer || null,
    referrer:      body.referrer || null,
    utm_source:    body.utm_source || null,
    utm_medium:    body.utm_medium || null,
    utm_campaign:  body.utm_campaign || null,
    utm_term:      body.utm_term || null,
    utm_content:   body.utm_content || null,
    ga_client_id:  body.ga_client_id || null,
    session_id:    body.session_id || null,
    anon_id:       body.anon_id || null,
    recaptcha_score: captcha.score ?? null,
    spam_score:    spam.score,
    spam_reasons:  spam.reasons,
    flagged:       spam.isFlagged,
    ip_hash:       hashIp(ip),
    user_agent:    req.headers['user-agent'] || null,
    raw:           body,
  };

  // 7. Mirror: DB write + GHL forward in parallel.
  const [dbResult, ghlResult] = await Promise.all([
    insertLead(row),
    forwardGhl(
      Object.fromEntries(Object.entries(body).filter(([k]) =>
        !['recaptcha_token', 'website', 'form_loaded_at'].includes(k)
      )),
    ),
  ]);

  if (dbResult.ok && ghlResult.status) {
    await markGhlStatus(dbResult.id, ghlResult.status);
  }

  log('info', 'lead-accepted', {
    db: dbResult.ok ? `id=${dbResult.id}` : `fail:${dbResult.reason}`,
    ghl: ghlResult.ok ? 'ok' : `fail:${ghlResult.status || ghlResult.reason}`,
    spam_score: spam.score,
    flagged: spam.isFlagged,
    cap: captcha.score ?? captcha.skipped ?? captcha.soft ?? null,
  });

  if (dbResult.ok || ghlResult.ok) {
    return res.status(200).json({ ok: true });
  }
  return res.status(502).json({ error: 'upstream-failed' });
};
