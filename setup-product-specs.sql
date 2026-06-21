-- ===========================================================================
--  setup-product-specs.sql
--  Category-wise product specifications (pickable choices).
--
--  Admin builds reusable spec templates (Fashion, Electronics, Utensils, …);
--  each template field is a pickable-choice list (Size, Color, Material, …).
--  Vendors pick a template per product and tick which options are available.
--  Customers pick one value per spec at add-to-cart; the choice travels with
--  the order (Phase 2).
--
--  Run PART 1 first (templates + product columns) — that ships the admin
--  builder, vendor fill and customer display. Run PART 2 when you are ready
--  to carry the chosen specs onto placed orders (rewrites the checkout RPC).
-- ===========================================================================


-- ─────────────────────────────────────────────────────────────────────────
--  PART 1 — spec templates + product columns
-- ─────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS spec_templates (
  id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name        TEXT NOT NULL,
  -- The option universe the admin defines, e.g.
  -- [{"key":"size","label":"Size","options":["XS","S","M","L","XL","XXL","XXXL"]},
  --  {"key":"color","label":"Color","options":["Red","Blue","Black"]}]
  fields      JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active   BOOLEAN NOT NULL DEFAULT true,
  sort_order  INT NOT NULL DEFAULT 0,
  created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT spec_templates_name_not_blank CHECK (length(trim(name)) > 0)
);

CREATE INDEX IF NOT EXISTS idx_spec_templates_active_sort
  ON spec_templates (is_active, sort_order);

COMMENT ON TABLE  spec_templates        IS 'Admin-defined specification templates (pickable choices), one per product category/type.';
COMMENT ON COLUMN spec_templates.fields IS 'Option universe: array of {key,label,options[]}. Vendors tick the available subset per product.';

-- Per-product: which template the vendor chose, and a denormalized snapshot of
-- the available options (label + options) so the storefront needs no join and
-- the product stays stable even if the template is later edited/deleted.
ALTER TABLE products
  ADD COLUMN IF NOT EXISTS spec_template_id UUID REFERENCES spec_templates(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS specs JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN products.specs IS 'Denormalized vendor-chosen availability: [{key,label,options[available]}].';

-- Verify PART 1:
--   SELECT count(*) FROM spec_templates;
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='products' AND column_name IN ('spec_template_id','specs');


-- ─────────────────────────────────────────────────────────────────────────
--  PART 2 — carry the chosen specs onto placed orders
--  (run only after PART 1 + the app are verified)
-- ─────────────────────────────────────────────────────────────────────────

-- ALTER TABLE order_items ADD COLUMN IF NOT EXISTS specs JSONB;
--
-- The place_marketplace_order RPC currently groups cart lines by product id and
-- sums qty, which would collapse different size/color buys of the same product
-- into one line. PART 2 rewrites it to keep a per-product sum for stock, but
-- build order_items grouped by (id, specs) and include specs in items_json.
-- (Authored separately once PART 1 is live and verified — see plan Phase 2.)
