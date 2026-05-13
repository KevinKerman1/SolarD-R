// SolarDetachPro web service: static site + /api/lead (reCAPTCHA → DB mirror → GHL) + /api/track (analytics).
// Node 18+, Express 4.

const path = require('node:path');
const fs = require('node:fs');
const express = require('express');

const handleLead = require('./routes/lead');
const handleTrack = require('./routes/track');

const PORT = process.env.PORT || 3000;
const ROOT = path.resolve(__dirname, '..');

if (!process.env.RECAPTCHA_SECRET) console.warn('[info] RECAPTCHA_SECRET not set — reCAPTCHA verification is skipped (in-app spam filter still active)');
if (!process.env.GHL_WEBHOOK_URL)  console.warn('[warn] GHL_WEBHOOK_URL not set — leads will only land in DB');
if (!process.env.DATABASE_URL_LEADS)     console.warn('[warn] DATABASE_URL_LEADS not set — leads will only forward to GHL');
if (!process.env.DATABASE_URL_ANALYTICS) console.warn('[warn] DATABASE_URL_ANALYTICS not set — /api/track is a no-op');

const app = express();
app.set('trust proxy', true);
app.disable('x-powered-by');

// CORS only for /api/* — static assets are same-origin once we're on Railway.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGIN ||
  'https://solardetachpro.com,https://www.solardetachpro.com').split(',').map(s => s.trim());

app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else {
    res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGINS[0]);
  }
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '64kb' }));
app.use(express.urlencoded({ extended: false, limit: '64kb' }));

// Routes
app.get('/healthz', (_req, res) => res.json({ ok: true }));
app.post('/api/lead', handleLead);
app.post('/api/track', handleTrack);

// Clean URLs: /scottsdale → scottsdale.html, /roofers → roofers.html, etc.
// Map known slugs explicitly so we don't accidentally serve unintended files.
const CLEAN_URL_MAP = {
  '/':                            'index.html',
  '/scottsdale':                  'scottsdale.html',
  '/tucson':                      'tucson.html',
  '/flagstaff':                   'flagstaff.html',
  '/mesa':                        'mesa.html',
  '/chandler':                    'chandler.html',
  '/tempe':                       'tempe.html',
  '/glendale':                    'glendale.html',
  '/press-kit':                   'press-kit.html',
  '/privacy-policy':              'privacy-policy.html',
  '/terms':                       'terms.html',
  '/thank-you':                   'thank-you.html',
  '/roofers':                     'roofers.html',
  '/services/removal-only':       'removal-only.html',
  '/services/insurance-claim':    'insurance-claim.html',
  '/services/panel-relocation':   'panel-relocation.html',
  '/services/roof-replacement':   'roof-replacement-solar.html',
};

for (const [slug, file] of Object.entries(CLEAN_URL_MAP)) {
  const full = path.join(ROOT, file);
  app.get(slug, (_req, res, next) => {
    fs.access(full, fs.constants.R_OK, (err) => {
      if (err) return next();
      res.sendFile(full);
    });
  });
}

// Static assets (JS, CSS, images, robots.txt, sitemap.xml) from repo root.
app.use(express.static(ROOT, {
  extensions: ['html'],
  index: false,
  dotfiles: 'ignore',
  setHeaders: (res, p) => {
    if (p.endsWith('.html')) {
      res.setHeader('Cache-Control', 'public, max-age=300, must-revalidate');
    } else if (/\.(js|css|png|jpg|jpeg|webp|svg|woff2?)$/.test(p)) {
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    }
  },
}));

// 404 — serve a simple message; SPA fallback not needed for a static MPA.
app.use((req, res) => {
  res.status(404).type('html').send('<!doctype html><title>404</title><h1>404 Not Found</h1><p><a href="/">Home</a></p>');
});

app.listen(PORT, () => {
  console.log(JSON.stringify({ t: new Date().toISOString(), level: 'info', msg: 'listening', port: PORT }));
});
