-- Create a test vendor
INSERT INTO vendors (name, slug, email, phone, address, description, is_active)
VALUES ('Rajkot Cuisine', 'rajkot-cuisine', 'restaurant@rajkot.com', '9876543210', '123 Main Street, Rajkot', 'Authentic Rajasthani cuisine and local favorites', true);

-- Get the vendor ID - copy the ID from results below
SELECT id, name, email FROM vendors WHERE slug = 'rajkot-cuisine';

-- ⚠️ IMPORTANT: Copy the vendor ID from above, then replace {VENDOR_ID} in the queries below

-- Create vendor staff account
-- Password: "password123" hashed as SHA256
INSERT INTO vendor_users (vendor_id, email, password_hash, role, is_active)
VALUES (
  '{VENDOR_ID}',
  'restaurant@rajkot.com',
  '482c811da5d5b4bc6d497ffa98491e38',
  'owner',
  true
);

-- Add test products (replace {VENDOR_ID} with actual vendor ID)
INSERT INTO products (vendor_id, name, category, description, price, active)
VALUES
  ('{VENDOR_ID}', 'Dal Baati Churma', 'Main Course', 'Traditional Rajasthani combo - lentils, baked wheat balls, and sweet dessert', 150, true),
  ('{VENDOR_ID}', 'Ker Sangri', 'Main Course', 'Local desert vegetables cooked with spices', 120, true),
  ('{VENDOR_ID}', 'Gatte Ki Sabzi', 'Main Course', 'Gram flour dumplings cooked in yogurt gravy', 130, true),
  ('{VENDOR_ID}', 'Bajra Roti', 'Bread', 'Pearl millet bread - soft and nutritious', 20, true),
  ('{VENDOR_ID}', 'Masala Chai', 'Beverage', 'Spiced Indian tea with milk', 30, true),
  ('{VENDOR_ID}', 'Fafda Jalebi', 'Dessert', 'Crispy lentil noodles with sweet jalebi', 80, true);

-- Verify data was created
SELECT COUNT(*) as product_count FROM products WHERE vendor_id = '{VENDOR_ID}';
