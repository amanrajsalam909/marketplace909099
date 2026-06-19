-- ============================================================================
-- Exchange is for FASHION items only. There is no clean "fashion" category in
-- the catalog, so eligibility is an explicit per-product flag the admin turns
-- on for fashion products. The customer only sees an "Exchange" option on a
-- delivered order that contains at least one exchangeable item, and only within
-- 48 hours of delivery (enforced in api/feedback.js). Safe to run once.
-- ============================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS exchangeable BOOLEAN NOT NULL DEFAULT false;
