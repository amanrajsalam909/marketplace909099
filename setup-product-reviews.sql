-- ============================================================================
-- Per-product reviews & ratings
-- ----------------------------------------------------------------------------
-- Moves reviews from one-per-order (rated against the shop) to per-product:
-- every item in a delivered order can be rated individually, and each product
-- gets its own aggregate star rating shown across the storefront.
--
-- Safe to re-run. Legacy order-level reviews (product_id NULL) stay valid and
-- keep feeding the shop-level average; they are simply excluded from the
-- per-product summary below.
-- ============================================================================

-- 1. Link a review to a product (and keep a denormalised name for display).
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS product_id   UUID REFERENCES products(id) ON DELETE CASCADE;
ALTER TABLE reviews ADD COLUMN IF NOT EXISTS product_name TEXT;

-- 2. Drop the old "one review per order" rule (auto-named when order_id was
--    declared UNIQUE) so an order can hold one review per product instead.
ALTER TABLE reviews DROP CONSTRAINT IF EXISTS reviews_order_id_key;

-- 3. New rule: one review per (order, product). NULLs are distinct in Postgres,
--    so legacy order-level rows (product_id NULL) never collide here.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_review_order_product ON reviews (order_id, product_id);

-- 4. Aggregation index for the per-product summary.
CREATE INDEX IF NOT EXISTS idx_reviews_product ON reviews (product_id, approved);

-- 5. Per-product rating summary — approved, product-scoped reviews only.
CREATE OR REPLACE VIEW product_ratings AS
SELECT product_id,
       ROUND(AVG(rating)::numeric, 1) AS avg_rating,
       COUNT(*)                        AS review_count
FROM reviews
WHERE approved = true AND product_id IS NOT NULL
GROUP BY product_id;
