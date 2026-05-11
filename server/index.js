// Lead-proxy: verifies reCAPTCHA v3 + honeypot + timing, then forwards to GHL.
// Stateless. Single file. Node 18+ (uses global fetch).

const http = require('node:http');

const PORT = process.env.PORT || 3000;
const RECAPTCHA_SECRET = process.env.RECAPTCHA_SECRET;
const GHL_WEBHOOK_URL = process.env.GHL_WEBHOOK_URL;
const MIN_SCORE = parseFloat(process.env.MIN_SCORE || '0.5');
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || 'https://solardetachpro.com';
const MIN_FORM_DURATION_MS = 3000;

if (!RECAPTCHA_SECRET || !GHL_WEBHOOK_URL) {
    console.error('FATAL: RECAPTCHA_SECRET and GHL_WEBHOOK_URL env vars are required');
    process.exit(1);
}

function log(level, msg, extra) {
    const line = { t: new Date().toISOString(), level, msg, ...(extra || {}) };
    console.log(JSON.stringify(line));
}

function setCors(res, origin) {
    const allowed = ALLOWED_ORIGIN.split(',').map(s => s.trim());
    if (origin && allowed.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
    } else {
        res.setHeader('Access-Control-Allow-Origin', allowed[0]);
    }
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
}

function send(res, status, body) {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(body));
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        let raw = '';
        req.on('data', chunk => {
            raw += chunk;
            if (raw.length > 32 * 1024) { reject(new Error('payload too large')); req.destroy(); }
        });
        req.on('end', () => resolve(raw));
        req.on('error', reject);
    });
}

function parseBody(raw, contentType) {
    if (!raw) return {};
    if (contentType && contentType.includes('application/json')) {
        try { return JSON.parse(raw); } catch { return {}; }
    }
    // application/x-www-form-urlencoded or multipart-as-urlencoded
    const params = new URLSearchParams(raw);
    const obj = {};
    for (const [k, v] of params) obj[k] = v;
    return obj;
}

async function verifyRecaptcha(token, ip) {
    if (!token) return { ok: false, reason: 'no-token' };
    const params = new URLSearchParams({ secret: RECAPTCHA_SECRET, response: token });
    if (ip) params.set('remoteip', ip);
    try {
        const r = await fetch('https://www.google.com/recaptcha/api/siteverify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: params.toString(),
        });
        const j = await r.json();
        if (!j.success) return { ok: false, reason: 'verify-failed', detail: j['error-codes'] };
        if (typeof j.score === 'number' && j.score < MIN_SCORE) return { ok: false, reason: 'low-score', score: j.score };
        return { ok: true, score: j.score };
    } catch (e) {
        return { ok: false, reason: 'verify-error', detail: String(e) };
    }
}

async function handleLead(req, res) {
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress;

    let raw;
    try { raw = await readBody(req); }
    catch (e) { return send(res, 413, { error: 'payload-too-large' }); }

    const body = parseBody(raw, req.headers['content-type'] || '');

    // 1. Honeypot — silent accept so bots don't learn we caught them
    if (body.website && String(body.website).trim() !== '') {
        log('info', 'honeypot-tripped', { ip });
        return send(res, 200, { ok: true });
    }

    // 2. Timing — same silent accept
    const loadedAt = parseInt(body.form_loaded_at || '0', 10);
    if (loadedAt > 0 && Date.now() - loadedAt < MIN_FORM_DURATION_MS) {
        log('info', 'timing-tripped', { ip, elapsed: Date.now() - loadedAt });
        return send(res, 200, { ok: true });
    }

    // 3. reCAPTCHA
    const v = await verifyRecaptcha(body.recaptcha_token, ip);
    if (!v.ok) {
        log('warn', 'recaptcha-rejected', { ip, reason: v.reason, score: v.score, detail: v.detail });
        return send(res, 403, { error: 'verification-failed' });
    }

    // 4. Strip internal fields, forward to GHL
    const forward = { ...body };
    delete forward.recaptcha_token;
    delete forward.website;
    delete forward.form_loaded_at;

    try {
        const ghlRes = await fetch(GHL_WEBHOOK_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(forward),
        });
        if (!ghlRes.ok) {
            log('error', 'ghl-forward-failed', { status: ghlRes.status });
            return send(res, 502, { error: 'upstream-failed' });
        }
        log('info', 'lead-accepted', { ip, score: v.score });
        return send(res, 200, { ok: true });
    } catch (e) {
        log('error', 'ghl-forward-error', { error: String(e) });
        return send(res, 502, { error: 'upstream-error' });
    }
}

const server = http.createServer(async (req, res) => {
    setCors(res, req.headers.origin);

    if (req.method === 'OPTIONS') {
        res.statusCode = 204;
        return res.end();
    }

    if (req.method === 'GET' && req.url === '/healthz') {
        return send(res, 200, { ok: true });
    }

    if (req.method === 'POST' && req.url === '/api/lead') {
        return handleLead(req, res);
    }

    return send(res, 404, { error: 'not-found' });
});

server.listen(PORT, () => log('info', 'listening', { port: PORT, minScore: MIN_SCORE }));
