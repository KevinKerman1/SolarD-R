/*!
 * SolarDetachPro custom analytics tracker
 * Sends events to /api/track. Vanilla JS, no deps. ~6 KB.
 *
 * Captures: pageview, scroll depth, dwell time, CTA clicks, outbound links,
 *           per-form-field focus/blur, submit attempts, form abandonment.
 * Never captures field values (PII). Only metadata: name of field, whether
 * it was filled, length, and whether it was valid.
 */
(function () {
  'use strict';

  if (window.__sdpTrackerLoaded) return;
  window.__sdpTrackerLoaded = true;

  // ---------- config ----------
  var ENDPOINT      = '/api/track';
  var BATCH_SIZE    = 10;
  var BATCH_FLUSH_MS = 4000;
  var DWELL_PING_MS = 15000;
  var SESSION_IDLE_MS = 30 * 60 * 1000;
  var SCROLL_THRESHOLDS = [25, 50, 75, 100];

  // ---------- IDs ----------
  function uuid() {
    if (crypto && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  function getAnonId() {
    try {
      var id = localStorage.getItem('sdp_anon');
      if (!id) { id = uuid(); localStorage.setItem('sdp_anon', id); }
      return id;
    } catch (_) { return uuid(); }
  }

  function getSessionId() {
    try {
      var now = Date.now();
      var raw = sessionStorage.getItem('sdp_sess');
      if (raw) {
        var parts = raw.split('|');
        if (parts.length === 2 && now - parseInt(parts[1], 10) < SESSION_IDLE_MS) {
          sessionStorage.setItem('sdp_sess', parts[0] + '|' + now);
          return parts[0];
        }
      }
      var id = uuid();
      sessionStorage.setItem('sdp_sess', id + '|' + now);
      return id;
    } catch (_) { return uuid(); }
  }

  function getGaClientId() {
    var m = document.cookie.match(/_ga=GA\d\.\d\.(.+?)(?:;|$)/);
    return m ? m[1] : null;
  }

  // ---------- UTM ----------
  function parseUtm() {
    try {
      var q = new URLSearchParams(location.search);
      var keys = ['utm_source','utm_medium','utm_campaign','utm_term','utm_content','gclid','fbclid'];
      var out = {}, any = false;
      keys.forEach(function (k) {
        var v = q.get(k);
        if (v) { out[k] = v; any = true; }
      });
      // Persist for the session so downstream pages keep attribution.
      if (any) {
        try { sessionStorage.setItem('sdp_utm', JSON.stringify(out)); } catch (_) {}
        return out;
      }
      var stored = sessionStorage.getItem('sdp_utm');
      return stored ? JSON.parse(stored) : null;
    } catch (_) { return null; }
  }

  var anonId    = getAnonId();
  var sessionId = getSessionId();
  var utm       = parseUtm();

  // ---------- queue + transport ----------
  var queue = [];
  var flushTimer = null;

  function send(payload) {
    var body = JSON.stringify(payload);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(ENDPOINT, blob)) return;
      }
      fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true,
        credentials: 'omit',
      }).catch(function () {});
    } catch (_) { /* swallow */ }
  }

  function flush() {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (queue.length === 0) return;
    var batch = queue.splice(0, queue.length);
    send({ events: batch });
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(flush, BATCH_FLUSH_MS);
  }

  function track(event_type, payload) {
    queue.push({
      session_id: sessionId,
      anon_id:    anonId,
      event_type: event_type,
      page_path:  location.pathname,
      referrer:   document.referrer || null,
      utm:        utm,
      payload:    payload || null,
    });
    if (queue.length >= BATCH_SIZE) flush();
    else scheduleFlush();
  }

  // Expose for inline form handlers
  window.sdpTrack = track;

  // ---------- pageview ----------
  track('pageview', {
    title: document.title,
    ga_client_id: getGaClientId(),
    screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio || 1 },
    viewport: { w: window.innerWidth, h: window.innerHeight },
  });

  // ---------- scroll depth ----------
  var fired = {};
  function onScroll() {
    var doc = document.documentElement;
    var scrolled = window.scrollY + window.innerHeight;
    var total = Math.max(doc.scrollHeight, doc.offsetHeight, 1);
    var pct = Math.min(100, Math.round((scrolled / total) * 100));
    for (var i = 0; i < SCROLL_THRESHOLDS.length; i++) {
      var t = SCROLL_THRESHOLDS[i];
      if (!fired[t] && pct >= t) {
        fired[t] = true;
        track('scroll', { pct: t });
      }
    }
  }
  var scrollRaf = null;
  window.addEventListener('scroll', function () {
    if (scrollRaf) return;
    scrollRaf = requestAnimationFrame(function () {
      scrollRaf = null;
      onScroll();
    });
  }, { passive: true });

  // ---------- dwell time ----------
  var dwellStart = Date.now();
  var dwellAccum = 0;
  var dwellActive = true;
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) {
      dwellAccum += Date.now() - dwellStart;
      dwellActive = false;
    } else {
      dwellStart = Date.now();
      dwellActive = true;
    }
  });
  setInterval(function () {
    if (!dwellActive) return;
    var ms = dwellAccum + (Date.now() - dwellStart);
    track('dwell', { ms: ms });
  }, DWELL_PING_MS);

  // ---------- clicks (CTA + outbound) ----------
  document.addEventListener('click', function (e) {
    var el = e.target.closest ? e.target.closest('a, button, [data-track]') : null;
    if (!el) return;

    var trackName = el.getAttribute('data-track');
    var href = el.getAttribute('href') || '';
    var isTel = /^tel:/i.test(href);
    var isMail = /^mailto:/i.test(href);
    var isOutbound = /^https?:/i.test(href) && href.indexOf(location.host) === -1;

    if (trackName) {
      track('click', { name: trackName, tag: el.tagName, text: (el.textContent || '').trim().slice(0, 80) });
    } else if (isTel) {
      track('click', { name: 'phone', href: href });
    } else if (isMail) {
      track('click', { name: 'email', href: href });
    } else if (isOutbound) {
      track('outbound', { href: href.slice(0, 256) });
    }
  }, { capture: true });

  // ---------- form instrumentation ----------
  // Watches every input/select/textarea inside any <form id="leadForm"|"ctaForm"|"roofersForm">.
  // Captures focus, blur (with filled/length/valid), submit attempts and successes.
  // On page hide, if any field was touched but never submitted, fires form_abandon.

  var FORM_IDS = ['leadForm', 'ctaForm', 'roofersForm'];
  var formState = {}; // id -> { touched: Set, filled: Set, lastField, submitted, attempts }

  function ensureFormState(id) {
    if (!formState[id]) formState[id] = { touched: {}, filled: {}, lastField: null, submitted: false, attempts: 0 };
    return formState[id];
  }

  function fieldKey(el) {
    return el.name || el.id || el.type || 'unknown';
  }

  function bindForm(form) {
    if (!form || form.__sdpBound) return;
    form.__sdpBound = true;
    var formId = form.id || 'form';

    form.addEventListener('focusin', function (e) {
      var el = e.target;
      if (!el.matches || !el.matches('input, select, textarea')) return;
      if (el.type === 'hidden' || el.name === 'website') return; // honeypot
      var st = ensureFormState(formId);
      var k = fieldKey(el);
      st.touched[k] = true;
      st.lastField = k;
      track('form_field', { form: formId, field: k, phase: 'focus' });
    }, { capture: true });

    form.addEventListener('focusout', function (e) {
      var el = e.target;
      if (!el.matches || !el.matches('input, select, textarea')) return;
      if (el.type === 'hidden' || el.name === 'website') return;
      var st = ensureFormState(formId);
      var k = fieldKey(el);
      var val = el.value || '';
      var filled = val.trim().length > 0;
      if (filled) st.filled[k] = true; else delete st.filled[k];
      var valid = typeof el.checkValidity === 'function' ? el.checkValidity() : true;
      track('form_field', {
        form: formId,
        field: k,
        phase: 'blur',
        filled: filled,
        length: val.length,
        valid: valid,
      });
    }, { capture: true });

    form.addEventListener('submit', function () {
      var st = ensureFormState(formId);
      st.attempts++;
      track('form_submit', { form: formId, phase: 'attempt', attempt: st.attempts });
    }, { capture: true });

    // Custom hook: pages can call window.sdpTrack('form_submit', { form, phase: 'success' }) after the fetch resolves.
    // We also infer success via navigation to /thank-you.
  }

  function bindAllForms() {
    FORM_IDS.forEach(function (id) {
      var f = document.getElementById(id);
      if (f) bindForm(f);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindAllForms);
  } else {
    bindAllForms();
  }

  // ---------- abandonment + final flush ----------
  function reportAbandonmentAndFlush() {
    FORM_IDS.forEach(function (id) {
      var st = formState[id];
      if (!st || st.submitted) return;
      var touched = Object.keys(st.touched);
      if (touched.length === 0) return;
      track('form_abandon', {
        form: id,
        fields_touched: touched,
        fields_filled: Object.keys(st.filled),
        last_field: st.lastField,
        attempts: st.attempts,
      });
    });
    var msTotal = dwellAccum + (dwellActive ? Date.now() - dwellStart : 0);
    track('engagement', { ms_total: msTotal });
    flush();
  }

  window.addEventListener('pagehide', reportAbandonmentAndFlush);
  window.addEventListener('beforeunload', reportAbandonmentAndFlush);

  // If the page lands on /thank-you, infer the previous form_submit succeeded.
  if (/\/thank-you/i.test(location.pathname)) {
    track('form_submit', { phase: 'success', inferred: true });
  }
})();
