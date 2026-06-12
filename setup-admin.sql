-- ============================================================================
--  RajkotMarket — Platform Administration Schema
--  Version  : 1.1
--  Target   : Supabase (PostgreSQL 15+)
--  Purpose  : Categories, platform-admin authentication, vendor categorisation
--  Safe to re-run: yes (idempotent — IF NOT EXISTS / ON CONFLICT guards)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. CATEGORIES — marketplace departments managed by the platform admin
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT        NOT NULL,
  icon        TEXT        NOT NULL DEFAULT '🛍️',
  sort_order  INTEGER     NOT NULL DEFAULT 100 CHECK (sort_order >= 0),
  is_active   BOOLEAN     NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT categories_name_not_blank CHECK (length(trim(name)) > 0)
);

-- Case-insensitive uniqueness: 'Fashion' and 'fashion' are the same category
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_name_ci
  ON categories (lower(trim(name)));

CREATE INDEX IF NOT EXISTS idx_categories_active_sort
  ON categories (is_active, sort_order);

COMMENT ON TABLE  categories            IS 'Marketplace departments (Electronics, Fashion, …) managed from the admin panel.';
COMMENT ON COLUMN categories.sort_order IS 'Lower numbers appear first on the storefront.';
COMMENT ON COLUMN categories.is_active  IS 'Hidden categories are invisible to customers but keep their vendor links.';

-- ----------------------------------------------------------------------------
-- 2. ADMIN USERS — platform owners (full marketplace control)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_users (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT        NOT NULL,
  password_hash TEXT        NOT NULL,                -- SHA-256, hex encoded
  is_active     BOOLEAN     NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login    TIMESTAMPTZ,

  CONSTRAINT admin_users_email_format CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CONSTRAINT admin_users_hash_length  CHECK (length(password_hash) = 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_users_email_ci
  ON admin_users (lower(email));

COMMENT ON TABLE admin_users IS 'Platform administrators. Separate from vendor_users — admins control the whole marketplace.';

-- ----------------------------------------------------------------------------
-- 3. ADMIN SESSIONS — short-lived login tokens (24 h)
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS admin_sessions (
  token      TEXT        PRIMARY KEY,                -- 64-char random hex
  admin_id   UUID        NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  CONSTRAINT admin_sessions_token_length CHECK (length(token) >= 32)
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry
  ON admin_sessions (expires_at);

COMMENT ON TABLE admin_sessions IS 'Active admin login sessions. Removing an admin cascades and revokes their sessions.';

-- ----------------------------------------------------------------------------
-- 4. VENDORS → CATEGORY LINK
--    ON DELETE SET NULL: deleting a category never deletes a shop —
--    affected shops simply become "uncategorised".
-- ----------------------------------------------------------------------------
ALTER TABLE vendors
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES categories(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_vendors_category_id
  ON vendors (category_id);

COMMENT ON COLUMN vendors.category_id IS 'Marketplace department this shop belongs to (nullable = uncategorised).';

-- ----------------------------------------------------------------------------
-- 5. SEED DATA — default departments (skips any that already exist)
-- ----------------------------------------------------------------------------
INSERT INTO categories (name, icon, sort_order) VALUES
  ('Food & Beverages',  '🍱',  10),
  ('Grocery',           '🛒',  20),
  ('Electronics',       '📱',  30),
  ('Fashion',           '👗',  40),
  ('Computers',         '💻',  50),
  ('Books',             '📚',  60),
  ('Toys & Games',      '🧸',  70),
  ('Personal Care',     '🧴',  80),
  ('Baby Products',     '🍼',  90),
  ('Science Equipment', '🔬', 100),
  ('Home & Garden',     '🪴', 110),
  ('Sports & Outdoors', '⚽', 120)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 6. BOOTSTRAP ADMIN ACCOUNT
--    Login    : amanrajsalam9@gmail.com
--    Password : admin123   →  ⚠ CHANGE IMMEDIATELY via Admin Panel → Settings
-- ----------------------------------------------------------------------------
INSERT INTO admin_users (email, password_hash)
VALUES (
  'amanrajsalam9@gmail.com',
  '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a9'
)
ON CONFLICT DO NOTHING;

-- ----------------------------------------------------------------------------
-- 7. DATA MIGRATION — file the existing demo shop under Food & Beverages
-- ----------------------------------------------------------------------------
UPDATE vendors
SET    category_id = (SELECT id FROM categories WHERE lower(name) = 'food & beverages')
WHERE  slug = 'rajkot-cuisine'
  AND  category_id IS NULL;

-- ----------------------------------------------------------------------------
-- 8. VERIFICATION — run after the above; expect 12 categories and 1 admin
-- ----------------------------------------------------------------------------
SELECT
  (SELECT count(*) FROM categories)  AS categories_created,
  (SELECT count(*) FROM admin_users) AS admin_accounts,
  (SELECT count(*) FROM vendors WHERE category_id IS NOT NULL) AS categorised_vendors;
