// In-app spam filter for lead submissions.
// Scores a submission across multiple signals. Threshold-based rejection.
//
// Score >= 5 → silent reject (route returns 200 OK so bots can't probe).
// Score 2-4 → accept, flag (review in DB).
// Score 0-1 → accept clean.

// ---------- Phrase blocklist ----------
// Categorized so we can tune. Each regex matches a known spam category.
const BLOCKED_PATTERNS = [
  // Gambling
  /\b(casino|poker|gambl(e|ing|er)|sportsbook|baccarat|roulette|slots? machine|jackpot|betting site)\b/i,
  /\b(bet365|1xbet|pokerstars|stake\.com)\b/i,

  // Adult / escort
  /\b(escort(s)?|massage parlor|adult service|hookup site|sugar (daddy|baby)|cam ?girl|cam ?model|onlyfans)\b/i,
  /\b(dating site|hot (girls?|women)|live cam)\b/i,

  // SEO / link-building outreach
  /\b(guest post|guest blog|guest writer|link insertion|link.{0,3}building|backlink|niche edit|sponsored post)\b/i,
  /\b(write for (you|your site)|article submission|content writer|content writing service)\b/i,
  /\b(seo service|seo expert|seo agency|rank your site|first page of google)\b/i,
  /\b(outreach team|outreach campaign|cold email service)\b/i,

  // Crypto / fake investment
  /\b(crypto(currency)?|bitcoin|ethereum|nft mint|forex trading|trading bot|signal group)\b/i,
  /\b(earn \$\d+|make \$\d+|24k\/day|guaranteed profit|investment opportunity)\b/i,

  // Loan / debt / financial spam
  /\b(personal loan|consolidation loan|debt relief|grant program|bank guarantee|loan offer)\b/i,

  // Fake job / "we are hiring" / recruiter spam
  /\b(remote position available|we are hiring|join our team|earn from home|work from home opportunity)\b/i,
  /\b(virtual assistant service|hire developers|freelance writer needed)\b/i,

  // Generic spam openings
  /\b(dear (sir|madam|admin|webmaster)|to whom it may concern|i hope this (email|message) finds you)\b/i,
  /\b(my name is .{0,40} and i (am|represent))\b/i,
];

// ---------- Disposable email domains ----------
const DISPOSABLE_DOMAINS = new Set([
  'mailinator.com', 'tempmail.com', '10minutemail.com', '10minutemail.net',
  'guerrillamail.com', 'guerrillamail.net', 'sharklasers.com', 'grr.la',
  'trashmail.com', 'trashmail.net', 'yopmail.com', 'throwaway.email',
  'temp-mail.org', 'temp-mail.io', 'fakeinbox.com', 'maildrop.cc',
  'getnada.com', 'inboxbear.com', 'mailcatch.com', 'mintemail.com',
  'mytemp.email', 'tempmailaddress.com', 'tempmailo.com', 'dispostable.com',
  'mailnesia.com', 'mohmal.com', 'spam4.me', 'tempr.email',
  'mail.tm', 'emailondeck.com', 'fakemailgenerator.com',
]);

// ---------- Valid US area codes (rough) ----------
// We just check the digit pattern; deeper validation isn't worth the maintenance.
const US_PHONE_RE = /^[2-9]\d{9}$/;

function digitsOnly(s) { return (s || '').toString().replace(/\D/g, ''); }

function countMatches(re, s) {
  const m = (s || '').match(re);
  return m ? m.length : 0;
}

function scoreSubmission(body) {
  const reasons = [];
  let score = 0;

  const name    = (body.name    || '').toString();
  const email   = (body.email   || '').toString().toLowerCase().trim();
  const phone   = (body.phone   || '').toString();
  const message = (body.message || '').toString();
  const service = (body.service || '').toString();
  const combined = `${name} ${email} ${message} ${service}`;

  // 1. Blocked phrases — any hit is decisive (+5)
  for (const re of BLOCKED_PATTERNS) {
    if (re.test(combined)) {
      score += 5;
      reasons.push('phrase-blocklist');
      break; // one strike is enough; don't double-count
    }
  }

  // 2. URL in name field — never legitimate (+5)
  if (/https?:\/\/|www\.[a-z]/i.test(name)) {
    score += 5; reasons.push('url-in-name');
  }

  // 3. Multiple URLs in message (+5); single URL in short message (+2)
  const urlMatches = countMatches(/https?:\/\/[^\s]+/gi, message);
  if (urlMatches >= 2) { score += 5; reasons.push('multi-url'); }
  else if (urlMatches === 1 && message.length < 250) { score += 2; reasons.push('short-msg-with-url'); }

  // 4. Non-Latin script — almost always bot for an English-language AZ home-service form
  if (/[\u0400-\u04FF\u0590-\u05FF\u0600-\u06FF\u3040-\u30FF\u4E00-\u9FFF]/.test(combined)) {
    score += 5; reasons.push('non-latin-script');
  }

  // 5. Email checks
  if (email) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
      score += 3; reasons.push('email-malformed');
    } else {
      const domain = email.split('@')[1];
      if (DISPOSABLE_DOMAINS.has(domain)) {
        score += 5; reasons.push('email-disposable');
      }
      if (/^[a-z]{20,}@/.test(email)) {
        // Long random local-part like "kxqzplmnabcdefg@gmail.com" — bot pattern
        score += 2; reasons.push('email-random-local');
      }
    }
  }

  // 6. Phone — required for AZ home services; bad phone is suspicious
  const phoneDigits = digitsOnly(phone);
  if (!phone) {
    score += 2; reasons.push('phone-missing');
  } else if (phoneDigits.length === 11 && phoneDigits[0] === '1') {
    // OK — US with country code
    const rest = phoneDigits.slice(1);
    if (!US_PHONE_RE.test(rest)) { score += 3; reasons.push('phone-invalid-us'); }
  } else if (phoneDigits.length === 10) {
    if (!US_PHONE_RE.test(phoneDigits)) { score += 3; reasons.push('phone-invalid-us'); }
  } else {
    score += 3; reasons.push('phone-bad-length');
  }

  // 7. Name sanity
  if (name.length < 2)   { score += 2; reasons.push('name-too-short'); }
  if (name.length > 80)  { score += 2; reasons.push('name-too-long'); }
  if (/\d{3,}/.test(name)) { score += 2; reasons.push('name-has-digits'); }

  // 8. Message length sanity
  if (message.length > 4000) { score += 2; reasons.push('msg-too-long'); }

  // 9. ALL-CAPS bursts in message (>40 chars, 80%+ uppercase)
  const longUpper = (message.match(/[A-Z\s!?.,]{40,}/g) || []).find(s => {
    const letters = s.replace(/[^A-Za-z]/g, '');
    return letters.length >= 30 && letters.replace(/[a-z]/g, '').length / letters.length > 0.8;
  });
  if (longUpper) { score += 1; reasons.push('all-caps-burst'); }

  // 10. Suspicious "hello, my company is..." pitch patterns
  if (/\b(my company|our company|we provide|we offer|we are a)\b/i.test(message)
      && /\b(service|agency|provider|company)\b/i.test(message)
      && message.length < 600) {
    score += 2; reasons.push('pitch-pattern');
  }

  return { score, reasons, isReject: score >= 5, isFlagged: score >= 2 };
}

// ---------- Per-IP rate limit (in-memory, no deps) ----------
const ipBuckets = new Map(); // ip → { count, resetAt }
const RL_WINDOW_MS = 60_000;
const RL_MAX = parseInt(process.env.RATE_LIMIT_PER_MIN || '5', 10);

function rateLimitCheck(ip) {
  if (!ip) return { ok: true };
  const now = Date.now();
  let b = ipBuckets.get(ip);
  if (!b || b.resetAt < now) {
    b = { count: 0, resetAt: now + RL_WINDOW_MS };
    ipBuckets.set(ip, b);
  }
  b.count++;

  // Lazy GC if map grows beyond 2k entries
  if (ipBuckets.size > 2000) {
    for (const [k, v] of ipBuckets) if (v.resetAt < now) ipBuckets.delete(k);
  }

  return { ok: b.count <= RL_MAX, count: b.count, max: RL_MAX };
}

module.exports = { scoreSubmission, rateLimitCheck };
