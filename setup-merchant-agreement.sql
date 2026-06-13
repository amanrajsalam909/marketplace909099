-- ============================================================================
--  RajkotMarket — Merchant Partnership Agreement & KYC / compliance record
--  Stores, per vendor, the onboarding agreement + KYC documents the admin
--  collects (GSTIN, PAN, Aadhaar, bank, ownership proof, Udyam/MSME, shop
--  items list, BIS, E-Waste EPR) and the shop's return/cancellation/delivery
--  policies — all in one JSONB column so no schema change is needed to add a
--  new document type later. Admin-managed; internal compliance record.
--
--  Shape:
--    {
--      "agreement":  { "status","start_date","end_date","signed_on","notes" },
--      "bank":       { "holder","account_number","ifsc","bank_name","status","note" },
--      "documents":  { "<key>": { "number","status","url","note" }, ... },
--      "policies":   { "return","cancellation","delivery" }
--    }
--  document keys: gstin, pan, aadhaar, ownership, udyam, items_list, bis, epr
--  statuses: Pending | Submitted | Verified | Rejected | N/A
--  Safe to re-run: yes
-- ============================================================================

ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS compliance JSONB NOT NULL DEFAULT '{}'::jsonb;

-- VERIFICATION — expect compliance_column = 1
SELECT count(*) AS compliance_column
FROM information_schema.columns
WHERE table_name = 'vendors' AND column_name = 'compliance';
