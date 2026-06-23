-- ============================================================================
--  RajkotMarket — Delivery allocation + Partner KYC / verification
--
--  Two missing pieces for delivery & pickup partners:
--
--  1. ALLOCATION (one active delivery per partner). Until now every delivery
--     partner saw EVERY 'ready' order as a shared pool. We add an explicit
--     assignment on the order; a partner claims an order and can hold only ONE
--     active delivery at a time (enforced in api/delivery.js).
--
--  2. KYC / verification. Delivery & pickup partners now carry a compliance
--     record (mirrors vendors.compliance) covering: Aadhaar, Driving Licence,
--     Vehicle Ownership, Vehicle RC book, Bank Account, Personal Mobile Number
--     and the Customer Relationship Agreement. Admin-managed; statuses
--     Pending|Submitted|Verified|Rejected|N/A. A delivery partner must be
--     VERIFIED before they can be allocated an order (see lib/partner-kyc.js).
--
--  Shape of compliance (one JSONB column, so new fields need no migration):
--    {
--      "agreement": { "status","signed_on","notes" },     -- customer relationship agreement
--      "mobile":    { "number","status","note" },          -- personal mobile number
--      "bank":      { "holder","account_number","ifsc","bank_name","status","note" },
--      "documents": { "aadhaar|license|vehicle_ownership|vehicle_rc": { "number","status","url","note" } }
--    }
--  Safe to re-run.
-- ============================================================================

-- 1. Delivery allocation -----------------------------------------------------
ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS assigned_delivery_partner_id UUID REFERENCES delivery_partners(id),
  ADD COLUMN IF NOT EXISTS delivery_assigned_at TIMESTAMPTZ;

-- Fast "is this partner free? / who owns this order?" lookups.
CREATE INDEX IF NOT EXISTS idx_orders_assigned_delivery
  ON orders (assigned_delivery_partner_id)
  WHERE assigned_delivery_partner_id IS NOT NULL;

-- 2. Partner KYC / verification ---------------------------------------------
ALTER TABLE delivery_partners
  ADD COLUMN IF NOT EXISTS compliance JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE return_partners
  ADD COLUMN IF NOT EXISTS compliance JSONB NOT NULL DEFAULT '{}'::jsonb;

-- VERIFICATION — expect 3 rows back (one column each), then check the orders cols.
SELECT table_name, column_name
FROM information_schema.columns
WHERE (table_name = 'delivery_partners' AND column_name = 'compliance')
   OR (table_name = 'return_partners'   AND column_name = 'compliance')
   OR (table_name = 'orders' AND column_name = 'assigned_delivery_partner_id')
ORDER BY table_name, column_name;
