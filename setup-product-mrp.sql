-- Optional MRP / "compare-at" price per product. When mrp > price, the
-- storefront shows the MRP struck through plus a "X% OFF" badge on the card.
-- Vendors set it on their own products (vendor dashboard). Safe to re-run.

ALTER TABLE products ADD COLUMN IF NOT EXISTS mrp DECIMAL(10,2);

-- VERIFICATION — expect mrp_column = 1
SELECT count(*) AS mrp_column
FROM information_schema.columns
WHERE table_name = 'products' AND column_name = 'mrp';
