# 🍱 Marketplace - Multi-Vendor Food Delivery Platform

A lightweight, zero-cost multi-vendor food delivery marketplace built for Rajkot with **Vercel** + **Supabase** + **Node.js**.

## Features

✅ **Multi-Vendor Support** — Multiple restaurants manage independently  
✅ **Customer Ordering** — Browse, add to cart, checkout from multiple vendors  
✅ **Vendor Dashboard** — Orders, products, analytics  
✅ **Order Tracking** — Real-time status updates (Pending → Delivered)  
✅ **Email Notifications** — Customers & vendors notified of orders  
✅ **Zero-Cost Stack** — Supabase free tier, Vercel free hosting  
✅ **Mobile Friendly** — Responsive HTML/CSS/JS (no frameworks)  

## Tech Stack

- **Frontend:** HTML5, vanilla JavaScript, responsive CSS
- **Backend:** Node.js serverless functions on Vercel
- **Database:** Supabase (PostgreSQL)
- **Email:** Nodemailer + Gmail/Resend
- **Hosting:** Vercel (free tier)

## Getting Started

### 1. Setup Supabase Tables

See [SETUP.md](SETUP.md) for detailed SQL setup instructions.

### 2. Environment Variables

Create `.env` file:

```
SUPABASE_URL=https://gmnlckfrkxvfftiumhwf.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
GMAIL_USER=your_gmail@gmail.com
GMAIL_PASS=your_app_password
APP_URL=https://marketplace909099.vercel.app
```

### 3. Install Dependencies

```bash
npm install
```

### 4. Deploy to Vercel

```bash
npm install -g vercel
vercel
```

Or use Vercel dashboard to import the GitHub repo.

## Project Structure

```
marketplace909099/
├── api/                      # Serverless functions
│   ├── vendor-auth.js       # Vendor login/session
│   ├── vendor-orders.js     # Vendor order dashboard API
│   ├── products.js          # Product management
│   ├── orders.js            # Customer orders API
│   └── marketplace.js       # Public vendor/product listing
├── lib/
│   ├── supabase.js          # Supabase client
│   ├── email.js             # Email templates
│   └── guard.js             # Security middleware
├── public/                   # Frontend HTML/JS
│   ├── index.html           # Customer storefront
│   ├── cart.html            # Shopping cart
│   ├── vendor-login.html    # Vendor login
│   └── vendor-dashboard.html # Vendor panel
├── .env                     # Environment variables
├── vercel.json              # Vercel configuration
└── package.json
```

## API Endpoints

### Public APIs (No Auth)
- `GET /api/marketplace?action=vendors` — List all active vendors
- `GET /api/marketplace?action=products&vendorId=xxx` — Products by vendor
- `POST /api/orders` — Place order

### Vendor APIs
- `POST /api/vendor-auth` — Vendor login/validate
- `POST /api/products` — Add/edit vendor products
- `GET /api/vendor-orders` — Vendor's orders (requires token)
- `POST /api/vendor-orders` — Update order status

## Database Schema

### vendors
- id, name, slug, email, phone, address, description, logo_url, is_active, commission_percent

### vendor_users
- id, vendor_id, email, password_hash, role, is_active

### products
- id, vendor_id, name, category, price, description, image_url, active

### orders
- id, order_id, vendor_id, customer_id, items_json, total, status, created_at

### customers
- id, phone, email, name, created_at

## Workflow

### Customer
1. Browse vendors on homepage
2. Select vendor → see products
3. Add items to cart
4. Checkout with delivery details
5. Receive order confirmation email

### Vendor
1. Login to dashboard
2. View incoming orders
3. Update order status
4. Add/manage products
5. View daily analytics

## Roadmap

**Phase 1 (Done):** Core multi-vendor marketplace  
**Phase 2:** Payment integration (Razorpay/UPI)  
**Phase 3:** Delivery partner tracking  
**Phase 4:** Customer reviews & ratings  
**Phase 5:** Admin marketplace dashboard  

## Cost Breakdown (₹)

- **Domain:** ~₹300/year (optional, can use Vercel subdomain free)
- **Hosting:** ₹0 (Vercel free tier)
- **Database:** ₹0 (Supabase free tier: 500MB, 2M req/month)
- **Email:** ₹0 (Gmail app password, unlimited)
- **Total:** ₹0/month (if using vercel subdomain)

## Support

For setup help, see [SETUP.md](SETUP.md).

## License

MIT - Open source, free to use and modify.

---

Built with ❤️ for Rajkot vendors. Made for zero-cost, maximum impact.
