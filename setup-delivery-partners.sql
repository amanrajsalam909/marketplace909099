-- ============================================================================
-- Delivery partners get real per-account logins (id + password) so the delivery
-- app can enforce ONE active session per account (signing in elsewhere logs the
-- old device out) — replacing the shared delivery PIN. Separate roster from the
-- return/exchange pickup partners. Safe to run once.
-- ============================================================================

CREATE TABLE IF NOT EXISTS delivery_partners (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  login_id      TEXT        NOT NULL UNIQUE,         -- stored lower-cased
  phone         TEXT,
  password_hash TEXT        NOT NULL,
  active        BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Login sessions. Token stored HASHED (sha256) — see lib/sessions.js.
CREATE TABLE IF NOT EXISTS delivery_sessions (
  token       TEXT        PRIMARY KEY,
  delivery_partner_id UUID NOT NULL REFERENCES delivery_partners(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_delivery_sessions_partner ON delivery_sessions (delivery_partner_id);
