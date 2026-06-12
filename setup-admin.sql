-- ============================================================
-- RUN THIS ONCE in Supabase SQL Editor
-- Adds: categories, admin auth, vendor->category link
-- ============================================================

-- Marketplace categories (managed by admin)
CREATE TABLE categories (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT UNIQUE NOT NULL,
  icon TEXT DEFAULT '🛍️',
  sort_order INT DEFAULT 100,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Platform admin accounts
CREATE TABLE admin_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP
);

CREATE TABLE admin_sessions (
  token TEXT PRIMARY KEY,
  admin_id UUID NOT NULL REFERENCES admin_users(id),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Link vendors to a category
ALTER TABLE vendors ADD COLUMN category_id UUID REFERENCES categories(id);
CREATE INDEX idx_vendors_category_id ON vendors(category_id);

-- Seed default categories
INSERT INTO categories (name, icon, sort_order) VALUES
  ('Food & Beverages',  '🍱', 10),
  ('Grocery',           '🛒', 20),
  ('Electronics',       '📱', 30),
  ('Fashion',           '👗', 40),
  ('Computers',         '💻', 50),
  ('Books',             '📚', 60),
  ('Toys & Games',      '🧸', 70),
  ('Personal Care',     '🧴', 80),
  ('Baby Products',     '🍼', 90),
  ('Science Equipment', '🔬', 100),
  ('Home & Garden',     '🪴', 110),
  ('Sports & Outdoors', '⚽', 120);

-- Create platform admin account
-- Login: amanrajsalam9@gmail.com / admin123  (CHANGE THIS PASSWORD after first login!)
INSERT INTO admin_users (email, password_hash, is_active)
VALUES ('amanrajsalam9@gmail.com', '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9', true);

-- Assign the existing test vendor to Food & Beverages
UPDATE vendors
SET category_id = (SELECT id FROM categories WHERE name = 'Food & Beverages')
WHERE slug = 'rajkot-cuisine';
