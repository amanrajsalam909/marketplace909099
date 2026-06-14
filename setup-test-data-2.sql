-- ============================================================================
-- setup-test-data-2.sql  —  SECOND test vendor
-- ----------------------------------------------------------------------------
-- Purpose: gives you a 2nd live shop (in a different category) so you can
-- verify the "one vendor per order" cart rule by switching shops in the
-- storefront and watching the discard-cart prompt appear.
--
-- Fully self-contained: no need to copy any vendor ID, and safe to re-run
-- (every step is guarded with NOT EXISTS).
--
-- Vendor login →  email: mart@rajkot.com   password: password123
-- ============================================================================

-- 1. The shop (filed under "Grocery"; the demo shop is "Food & Beverages")
INSERT INTO vendors (name, slug, email, phone, address, description, is_active, category_id)
SELECT 'Saurashtra Mart', 'saurashtra-mart', 'mart@rajkot.com', '9123456780',
       '45 Kalawad Road, Rajkot', 'Daily grocery & household essentials', true,
       (SELECT id FROM categories WHERE lower(name) = 'grocery')
WHERE NOT EXISTS (SELECT 1 FROM vendors WHERE slug = 'saurashtra-mart');

-- Storefront settings (delivery fee, min order, COD, UPI, open for orders)
UPDATE vendors
SET    is_open = true, accepts_cod = true, delivery_fee = 25, min_order = 99,
       upi_id = 'saurashtramart@upi'
WHERE  slug = 'saurashtra-mart';

-- 2. Owner login  (password_hash = SHA256('password123'))
INSERT INTO vendor_users (vendor_id, email, password_hash, role, is_active)
SELECT v.id, 'mart@rajkot.com',
       'ef92b778bafe771e89245b89ecbc08a44a4e166c06659911881f383d4473e94f',
       'owner', true
FROM   vendors v
WHERE  v.slug = 'saurashtra-mart'
  AND  NOT EXISTS (
         SELECT 1 FROM vendor_users u
         WHERE u.vendor_id = v.id AND u.email = 'mart@rajkot.com');

-- 3. Products
INSERT INTO products (vendor_id, name, category, description, price, stock, active)
SELECT v.id, p.name, p.cat, p.descr, p.price, 100, true
FROM   vendors v
CROSS JOIN (VALUES
  ('Aashirvaad Atta 5kg',      'Grocery',   'Whole-wheat flour, 5 kg pack',        285),
  ('Fortune Sunflower Oil 1L', 'Grocery',   'Refined sunflower cooking oil',       140),
  ('Tata Salt 1kg',            'Grocery',   'Iodised table salt',                   28),
  ('Amul Butter 500g',         'Dairy',     'Pasteurised salted butter',           265),
  ('Surf Excel 1kg',           'Household', 'Detergent powder',                    120),
  ('Maggi Noodles 12-pack',    'Packaged',  'Masala instant noodles, family pack', 168)
) AS p(name, cat, descr, price)
WHERE  v.slug = 'saurashtra-mart'
  AND  NOT EXISTS (
         SELECT 1 FROM products px
         WHERE px.vendor_id = v.id AND px.name = p.name);

-- 4. Verify — expect 1 row: Saurashtra Mart, Grocery, 6 products
SELECT v.name, v.slug, v.is_active, c.name AS category,
       (SELECT count(*) FROM products WHERE vendor_id = v.id) AS products
FROM   vendors v
LEFT   JOIN categories c ON c.id = v.category_id
WHERE  v.slug = 'saurashtra-mart';
