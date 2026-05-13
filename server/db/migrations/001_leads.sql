CREATE TABLE IF NOT EXISTS leads (
  id              BIGSERIAL PRIMARY KEY,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  name            TEXT,
  phone           TEXT,
  email           TEXT,
  service         TEXT,
  message         TEXT,
  source_page     TEXT,
  referrer        TEXT,
  utm_source      TEXT,
  utm_medium      TEXT,
  utm_campaign    TEXT,
  utm_term        TEXT,
  utm_content     TEXT,
  ga_client_id    TEXT,
  session_id      TEXT,
  anon_id         TEXT,
  recaptcha_score NUMERIC,
  spam_score      NUMERIC,
  spam_reasons    JSONB,
  flagged         BOOLEAN NOT NULL DEFAULT false,
  ip_hash         TEXT,
  user_agent      TEXT,
  ghl_forwarded   BOOLEAN NOT NULL DEFAULT false,
  ghl_status      INT,
  raw             JSONB
);

-- Idempotent column adds for existing tables (no-op on fresh installs)
ALTER TABLE leads ADD COLUMN IF NOT EXISTS spam_score   NUMERIC;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS spam_reasons JSONB;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS flagged      BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS leads_created_at_idx ON leads (created_at DESC);
CREATE INDEX IF NOT EXISTS leads_email_idx      ON leads (email);
CREATE INDEX IF NOT EXISTS leads_phone_idx      ON leads (phone);
CREATE INDEX IF NOT EXISTS leads_source_idx     ON leads (source_page);
CREATE INDEX IF NOT EXISTS leads_session_idx    ON leads (session_id);
CREATE INDEX IF NOT EXISTS leads_flagged_idx    ON leads (flagged) WHERE flagged = true;
