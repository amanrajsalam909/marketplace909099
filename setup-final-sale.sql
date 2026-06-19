-- ============================================================================
-- Final-sale items: per the policy, innerwear/hygiene, cosmetics, customised
-- and clearance items are NON-returnable and NON-exchangeable. Admin marks such
-- products final_sale. Return/Exchange is blocked only when EVERY item in the
-- order is final-sale (mixed orders stay returnable). Safe to run once.
-- ============================================================================

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS final_sale BOOLEAN NOT NULL DEFAULT false;
