# Marketplace Setup Guide

## Step 1: Create Supabase Tables

Go to your Supabase dashboard: https://supabase.com/dashboard/project/gmnlckfrkxvfftiumhwf

Click **SQL Editor** and run these queries to create all tables:

```sql
-- Vendors table
CREATE TABLE vendors (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  email TEXT UNIQUE NOT NULL,
  phone TEXT,
  address TEXT,
  description TEXT,
  logo_url TEXT,
  banner_url TEXT,
  is_active BOOLEAN DEFAULT true,
  commission_percent DECIMAL(5,2) DEFAULT 15,
  settings_json JSONB,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Vendor users/staff
CREATE TABLE vendor_users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT DEFAULT 'staff',
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  last_login TIMESTAMP,
  UNIQUE(vendor_id, email)
);

-- Vendor sessions
CREATE TABLE vendor_sessions (
  token TEXT PRIMARY KEY,
  vendor_id UUID NOT NULL REFERENCES vendors(id),
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Products table
CREATE TABLE products (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  vendor_id UUID REFERENCES vendors(id),
  name TEXT NOT NULL,
  category TEXT,
  description TEXT,
  price DECIMAL(10,2) NOT NULL,
  image_url TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Customers table
CREATE TABLE customers (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  phone TEXT UNIQUE NOT NULL,
  email TEXT,
  name TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Orders table
CREATE TABLE orders (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  order_id TEXT UNIQUE NOT NULL,
  vendor_id UUID REFERENCES vendors(id),
  customer_id UUID REFERENCES customers(id),
  customer_name TEXT,
  customer_email TEXT,
  customer_phone TEXT,
  delivery_address TEXT,
  items_json JSONB,
  total DECIMAL(10,2),
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for performance
CREATE INDEX idx_products_vendor_id ON products(vendor_id);
CREATE INDEX idx_products_active ON products(active);
CREATE INDEX idx_orders_vendor_id ON orders(vendor_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_customer_id ON orders(customer_id);
CREATE INDEX idx_customers_phone ON customers(phone);
```

---

## Step 2: Create Test Vendor

In the Supabase SQL editor, run this to create your first vendor:

```sql
-- Create a vendor
INSERT INTO vendors (name, slug, email, phone, address, description, is_active)
VALUES (
  'Rajkot Cuisine',
  'rajkot-cuisine',
  'restaurant@rajkot.com',
  '9876543210',
  '123 Main Street, Rajkot',
  'Authentic Rajasthani cuisine and local favorites',
  true
);

-- Get the vendor ID (copy this from results)
SELECT id, name, email FROM vendors WHERE slug = 'rajkot-cuisine';
```

Now create a vendor user account. **Replace {VENDOR_ID} with the ID from above:**

```sql
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
```

To generate a password hash, use this bash command:
```bash
echo -n "password123" | sha256sum
# Output: 482c811da5d5b4bc6d497ffa98491e38 (example)
```

---

## Step 3: Create Test Products

In the Supabase SQL editor:

```sql
-- Get your vendor ID first
SELECT id FROM vendors WHERE slug = 'rajkot-cuisine';

-- Then insert products (replace {VENDOR_ID}):
INSERT INTO products (vendor_id, name, category, description, price, active)
VALUES
  ('{VENDOR_ID}', 'Dal Baati Churma', 'Main Course', 'Traditional Rajasthani combo', 150, true),
  ('{VENDOR_ID}', 'Ker Sangri', 'Main Course', 'Local desert vegetables', 120, true),
  ('{VENDOR_ID}', 'Gatte Ki Sabzi', 'Main Course', 'Gram flour dumplings in gravy', 130, true),
  ('{VENDOR_ID}', 'Bajra Roti', 'Bread', 'Pearl millet bread', 20, true),
  ('{VENDOR_ID}', 'Masala Chai', 'Beverage', 'Spiced tea', 30, true),
  ('{VENDOR_ID}', 'Fafda Jalebi', 'Dessert', 'Crispy lentil noodles with sweet jalebi', 80, true);
```

---

## Step 4: Install & Run Locally

```bash
cd /home/my-pc/marketplace909099

# Install dependencies
npm install

# Run locally (you'll need Node.js)
node -v  # Make sure Node.js is installed

# To test the backend, use curl or Postman
curl http://localhost:3000/api/marketplace?action=vendors
```

---

## Step 5: Deploy to Vercel

1. **Create GitHub repo:**
   ```bash
   cd /home/my-pc/marketplace909099
   git add .
   git commit -m "Initial marketplace setup"
   git remote add origin https://github.com/amanrajsalam909/marketplace909099.git
   git push -u origin main
   ```

2. **Deploy to Vercel:**
   - Go to https://vercel.com/new
   - Import the repository: `https://github.com/amanrajsalam909/marketplace909099`
   - Name: `marketplace909099`
   - Environment variables (add these):
     - `SUPABASE_URL`: `https://gmnlckfrkxvfftiumhwf.supabase.co`
     - `SUPABASE_SERVICE_ROLE_KEY`: (your service role key)
     - `GMAIL_USER`: `amanrajsalam9@gmail.com`
     - `GMAIL_PASS`: `vvai nqkf unzq anyb`
     - `APP_URL`: `https://marketplace909099.vercel.app`
   - Click **Deploy**

---

## Step 6: Test the Marketplace

### Customer Flow:
1. Go to https://marketplace909099.vercel.app
2. See "Rajkot Cuisine" restaurant
3. Click on it to view products
4. Add items to cart
5. Click "Cart" → fill in details → "Place Order"

### Vendor Flow:
1. Go to https://marketplace909099.vercel.app/vendor-login.html
2. Login with:
   - Email: `restaurant@rajkot.com`
   - Password: `password123`
3. See orders in dashboard
4. Update order status (Pending → Confirmed → Preparing → Ready → Delivered)
5. Add new products

---

## Password Hashing

To create a vendor with a different password:

```bash
# Generate SHA256 hash
echo -n "your_password_here" | sha256sum

# Example output: abc123...
# Use that hash in the vendor_users INSERT
```

---

## Troubleshooting

**"Products not showing":**
- Check vendor_id is correct in products table
- Verify vendor is_active = true
- Check products.active = true

**"Login fails":**
- Verify vendor_users has correct password_hash (use SHA256)
- Check vendor_sessions table is created
- Ensure vendor_id exists in vendors table

**"Emails not sending":**
- Verify GMAIL_USER and GMAIL_PASS in .env
- Check Gmail app password is correct (16 chars with spaces)
- Enable "Less secure apps" if on older Gmail account

---

## Next Steps

After deployment, you can:
1. Add more vendors
2. Customize vendor details (logo, banner, description)
3. Monitor orders in vendor dashboard
4. View analytics and revenue per vendor
5. Set up payment processing (manual for MVP)

Happy selling! 🎉
