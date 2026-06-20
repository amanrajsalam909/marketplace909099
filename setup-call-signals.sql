-- ============================================================================
-- WebRTC voice-call signaling relay (POC). Browsers exchange SDP offer/answer
-- and ICE candidates through these rows (polled via /api/feedback) until the
-- peer-to-peer audio connection is up; after that, media flows directly P2P.
-- room = order_id. Safe to run once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS call_signals (
  id         BIGSERIAL   PRIMARY KEY,
  room       TEXT        NOT NULL,            -- order_id
  sender     TEXT        NOT NULL,            -- 'partner' | 'customer'
  kind       TEXT        NOT NULL,            -- offer | answer | ice | bye
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_call_signals_room ON call_signals (room, id);
CREATE INDEX IF NOT EXISTS idx_call_signals_poll ON call_signals (sender, kind, created_at);
