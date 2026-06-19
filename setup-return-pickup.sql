-- ============================================================================
-- Return PICKUP workflow: named pickup partners, per-pickup OTP (shown in the
-- customer's profile), 4-angle photo QC for flagged products, and a refund vs
-- same-day-exchange branch. Extends the existing return_requests pipeline
-- (setup-returns.sql). Safe to run once in the Supabase SQL editor.
--
-- Three safeguard gates before any money moves:
--   1. valid reason at request time (existing submit-return)
--   2. the pickup partner's physical 4-angle photo QC (flagged products)
--   3. admin final approval -> process_return_refund()
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. Named pickup partners. Each has their own login id + password (bcrypt via
--    lib/password.js, same as vendors). Admin creates / disables them.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS return_partners (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT        NOT NULL,
  login_id      TEXT        NOT NULL UNIQUE,         -- stored lower-cased
  phone         TEXT,
  password_hash TEXT        NOT NULL,
  active        BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Partner login sessions. Token is stored HASHED (sha256) — see lib/sessions.js.
CREATE TABLE IF NOT EXISTS partner_sessions (
  token       TEXT        PRIMARY KEY,
  partner_id  UUID        NOT NULL REFERENCES return_partners(id) ON DELETE CASCADE,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_partner_sessions_partner ON partner_sessions (partner_id);

-- ----------------------------------------------------------------------------
-- 2. Pickup OTP — one per order, shown in the customer's profile (account.html)
--    and read out to the partner at the door. Mirrors delivery_otps.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS return_otps (
  order_id    TEXT        PRIMARY KEY REFERENCES orders(order_id) ON DELETE CASCADE,
  otp         TEXT        NOT NULL,
  attempts    INT         NOT NULL DEFAULT 0,
  expires_at  TIMESTAMPTZ NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 3. Return QC photos (Phase 2). Live copies sit on Cloudinary; on case close
--    they are archived to Google Drive and the Cloudinary asset is deleted.
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS return_photos (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    TEXT        NOT NULL REFERENCES orders(order_id) ON DELETE CASCADE,
  product_id  UUID,
  slot        TEXT        NOT NULL,                  -- top | bottom | left | right
  public_id   TEXT,                                  -- Cloudinary public_id (for deletion)
  url         TEXT        NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  archived_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_return_photos_order ON return_photos (order_id);

-- ----------------------------------------------------------------------------
-- 4. Extend return_requests with the pickup / QC / archive columns.
-- ----------------------------------------------------------------------------
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS assigned_partner_id UUID REFERENCES return_partners(id);
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS assigned_at  TIMESTAMPTZ;
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS resolution   TEXT;          -- 'refund' | 'exchange'
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS qc_status    TEXT;          -- 'pending' | 'passed' | 'failed'
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS qc_note      TEXT;
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS picked_up_at TIMESTAMPTZ;
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS archived     BOOLEAN DEFAULT false;
ALTER TABLE return_requests ADD COLUMN IF NOT EXISTS archived_at  TIMESTAMPTZ;

-- The status column already exists (setup-returns.sql). New status vocabulary:
--   Requested | Approved | Rejected | Assigned | Picked up | QC failed
--   | Refunded | Exchange scheduled | Exchanged

-- ----------------------------------------------------------------------------
-- 5. Per-product photo-QC flag (Phase 2). Only flagged products require the
--    4-angle inspection at pickup; everything else passes on a visual OK.
-- ----------------------------------------------------------------------------
ALTER TABLE products ADD COLUMN IF NOT EXISTS return_photo_qc BOOLEAN NOT NULL DEFAULT false;

-- ----------------------------------------------------------------------------
-- 6. Customer refund destination (Phase 3). If present -> refund; otherwise the
--    return is resolved as a same-day exchange of the same product.
-- ----------------------------------------------------------------------------
ALTER TABLE customers ADD COLUMN IF NOT EXISTS refund_method  TEXT;     -- 'upi' | 'bank'
ALTER TABLE customers ADD COLUMN IF NOT EXISTS refund_upi     TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_account   TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_ifsc      TEXT;
ALTER TABLE customers ADD COLUMN IF NOT EXISTS bank_holder    TEXT;
