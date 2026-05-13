CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  ts          TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id  TEXT,
  anon_id     TEXT,
  event_type  TEXT NOT NULL,
  page_path   TEXT,
  referrer    TEXT,
  utm         JSONB,
  payload     JSONB,
  ip_hash     TEXT,
  user_agent  TEXT
);

CREATE INDEX IF NOT EXISTS events_session_idx ON events (session_id);
CREATE INDEX IF NOT EXISTS events_type_ts_idx ON events (event_type, ts DESC);
CREATE INDEX IF NOT EXISTS events_page_ts_idx ON events (page_path, ts DESC);
CREATE INDEX IF NOT EXISTS events_anon_idx    ON events (anon_id);

-- Convenience view: lead-form funnel by session
CREATE OR REPLACE VIEW form_funnel AS
SELECT
  session_id,
  page_path,
  MIN(ts) FILTER (WHERE event_type = 'pageview')      AS landed_at,
  MIN(ts) FILTER (WHERE event_type = 'form_field' AND payload->>'phase' = 'focus') AS first_focus,
  MIN(ts) FILTER (WHERE event_type = 'form_submit' AND payload->>'phase' = 'attempt') AS attempted,
  MIN(ts) FILTER (WHERE event_type = 'form_submit' AND payload->>'phase' = 'success') AS submitted,
  MIN(ts) FILTER (WHERE event_type = 'form_abandon') AS abandoned,
  COUNT(*) FILTER (WHERE event_type = 'form_field')   AS field_events,
  COUNT(*) FILTER (WHERE event_type = 'scroll')       AS scroll_events
FROM events
WHERE session_id IS NOT NULL
GROUP BY session_id, page_path;
