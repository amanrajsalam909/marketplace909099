# RajkotMarket — Privacy Policy

**Effective Date:** June 18, 2026
**Last Updated:** June 18, 2026
**Validated against:** IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021 — Rules 3(1) and 3(2)

> This Privacy Policy explains what personal data RajkotMarket collects, why it is collected, how it is used, who it is shared with, and what rights you have over your data. We are committed to being transparent — this policy describes only what we actually do, nothing more.

---

## 1. Who We Are

RajkotMarket is a local online marketplace operated from Rajkot, Gujarat, India. We connect customers with local vendors for fast delivery of products within Rajkot city and surrounding serviceable areas. RajkotMarket acts as an **intermediary** within the meaning of the Information Technology Act, 2000. For the purposes of this Privacy Policy, "RajkotMarket", "we", "us", or "our" refers to the platform operator. "You" refers to any customer, vendor, delivery partner, or visitor using our platform.

---

## 2. What Data We Collect

We collect only what is necessary to operate the service. Below is a precise list of every category of data we collect and why.

### 2.1 Customer Data

| Data | Why We Collect It |
|---|---|
| **Mobile number (10-digit)** | Primary identifier — used for OTP login, order linkage, and delivery coordination |
| **Email address** | Used to send the login OTP; order confirmations and complaint alerts |
| **Full name** | Displayed on your account and orders; optional until checkout |
| **Delivery addresses** | Up to 3 saved slots (Home / Office / Other) — pre-fill future checkouts |
| **Order history** | Items ordered, amounts, delivery address per order, order status and events |
| **Product reviews** | Star rating and comment you submit on delivered items |
| **Return & complaint records** | Reason, status, and communication trail on any return or complaint you raise |

We do **not** collect: date of birth, gender, government ID, financial account details, or precise GPS location. We do not track you across other websites.

---

### 2.2 Session & Authentication Data

| Data | How It Is Stored |
|---|---|
| **Session token** | Generated as a cryptographically random 32-byte value; stored as a SHA-256 hash in the database — the raw token is never stored on our servers |
| **OTP code** | Stored temporarily during verification only; deleted immediately after a successful or expired OTP attempt |
| **Login attempts** | Tracked by email identifier to block repeated failed logins (invisible throttle — you will not be locked out for normal use) |

Session tokens are stored in your browser's **localStorage** for the duration of your session. Clearing your browser data or logging out removes them immediately.

---

### 2.3 Order & Transaction Data

When you place an order, we record:

- Products ordered (name, quantity, price, product ID)
- Order total and payment method (online / COD)
- Delivery address for that specific order
- Timestamps (placed, accepted, dispatched, delivered)
- Delivery OTP (generated and sent to your phone; stored temporarily and deleted after delivery confirmation)

Payment processing for online payments is handled entirely by our third-party payment gateway. We do **not** receive or store your card number, CVV, UPI PIN, or net banking credentials.

---

### 2.4 Vendor Data

Vendors provide:
- Business name, owner name, email, and mobile number
- Shop details (description, logo, category, address)
- KYC and merchant agreement acceptance records
- Product listings (name, price, stock, images)
- Bank/payout details (stored securely for commission settlements)

Vendor passwords are stored as **bcrypt hashes** (cost 12) — never as plain text. Legacy SHA-256 hashes are silently upgraded to bcrypt on next login.

---

### 2.5 Delivery Partner Data

- Name and assigned delivery PIN (used for delivery authentication)
- Delivery records linked to orders they fulfilled

---

### 2.6 Technical & Log Data

We do **not** run our own analytics or logging beyond what Vercel (our hosting provider) collects at the infrastructure level. Vercel may log:
- Request timestamps and HTTP method
- Response status codes
- General geographic region of requests (not precise location)

We do not use cookies. We do not use advertising trackers, pixel tags, or fingerprinting.

---

## 3. How We Use Your Data

| Purpose | Data Used |
|---|---|
| **OTP login** | Mobile number, email, OTP code |
| **Order fulfilment** | Name, delivery address, mobile number, order items |
| **Delivery coordination** | Mobile number, delivery address, delivery OTP |
| **Order history & tracking** | Order records, status events |
| **Return & refund processing** | Order data, mobile number, bank details (COD refunds) |
| **Complaint handling** | Name, email, order data, complaint description |
| **Account management** | Name, phone, email, saved addresses |
| **Fraud & abuse prevention** | Login attempt records (throttle), session tokens |
| **Platform backup** | Order, customer, return, and complaint records (archived to Google Drive) |
| **Email notifications** | Email address (order confirmation, OTP, complaint alerts) |
| **Legal compliance** | Order records, user registration data retained as required by law |

We do **not** use your data for: advertising, profiling, selling to third parties, credit scoring, or automated decision-making that affects your rights.

---

## 4. Third-Party Services We Use

We use the following external services. Your data may be processed by them under their own privacy policies.

| Service | Purpose | Data Shared |
|---|---|---|
| **Supabase** (supabase.com) | Database hosting (PostgreSQL) | All structured data — customers, orders, vendors, reviews, sessions |
| **Vercel** (vercel.com) | Platform hosting & serverless functions | Request logs at infrastructure level |
| **Google Drive** (drive.google.com) | Nightly order archive backups + admin manual backups | Order records, customer records, return/complaint records as JSON files in the platform operator's Drive account |
| **Gmail / Google SMTP** | Sending OTP emails and order notifications | Customer email address + OTP / notification content |
| **OpenStreetMap / Nominatim** (nominatim.openstreetmap.org) | Delivery route calculation | No personal data — only geographic zone queries |
| **Payment Gateway** | Processing online payments (UPI / card / netbanking) | Payment amount and order reference only — card/UPI credentials never reach our servers |
| **cron-job.org** | Scheduling the nightly database cleanup job | Only the trigger URL with an Authorization token — no personal data |

We do not use: Google Analytics, Facebook Pixel, Hotjar, Mixpanel, or any advertising networks.

---

## 5. Data Retention

| Data | Retention Period |
|---|---|
| **Active customer accounts** | Until you request deletion |
| **User registration data after account deletion** | **180 days** post-cancellation, as required by Rule 3(1)(h) of the IT Rules 2021, then permanently deleted |
| **Orders** | Order row kept indefinitely (needed for accounting and reviews). Full detail (items, address) archived to Google Drive and removed from live database after **15 days post-delivery** |
| **Removed or disabled content** | Preserved for **180 days** for investigation purposes as required by Rule 3(1)(g) of the IT Rules 2021, then deleted |
| **OTP sessions** | Deleted immediately after use or expiry (under 10 minutes) |
| **Customer sessions** | Auto-expire after **30 days** of inactivity |
| **Vendor sessions** | Auto-expire after **7 days** |
| **Admin sessions** | Auto-expire after **24 hours** |
| **Login attempt records** | Cleared after successful login or after the 15-minute block window |
| **Delivery OTPs** | Deleted after delivery confirmation |
| **Reviews** | Kept as long as the associated product and vendor are active |
| **Return & complaint records** | Minimum **1 year** for regulatory and accounting compliance |

Google Drive archive backups are retained as long as the platform operator chooses. The platform operator controls this retention and may delete archives at any time.

---

## 6. Data Security

We take the following technical measures to protect your data:

- **Session tokens hashed at rest** — raw tokens are never stored in the database; only SHA-256 hashes are stored
- **Session tokens sent via Authorization header** — not in URLs (not exposed in server logs or browser history)
- **Passwords bcrypt-hashed** (cost 12) for vendor and admin accounts
- **OTP-only login for customers** — no password to steal or brute-force
- **Invisible login throttle** — repeated failed logins are blocked without exposing this to an attacker
- **HTTPS enforced** — HSTS header with a 2-year duration and preload flag
- **HTTP security headers** — X-Content-Type-Options, X-Frame-Options, Referrer-Policy, Permissions-Policy, Content-Security-Policy (geolocation, microphone, camera, and payment APIs all disabled)
- **Supabase service-role key** never exposed in client-side HTML or JavaScript

No system is 100% secure. In the event of a data breach that materially affects your personal data, we will notify affected users within a reasonable timeframe as required by applicable law.

---

## 7. Your Rights

Under the **Digital Personal Data Protection Act, 2023 (DPDP Act)** and the **Information Technology Act, 2000**, you have the following rights:

### 7.1 Right to Access
You can request a summary of the personal data we hold about you by contacting the Grievance Officer. We will respond within **15 days**.

### 7.2 Right to Correction
If your name, email, or address is incorrect, you can update it directly in your account profile at any time, or by contacting us.

### 7.3 Right to Erasure (Deletion)
You may request deletion of your account and associated personal data. We will:
- Delete your name, email, saved addresses, and active session records
- Retain your registration data for **180 days** post-deletion as required by law (Rule 3(1)(h), IT Rules 2021), then permanently delete it
- Retain order records in anonymised form for accounting and legal compliance
- Retain reviews in anonymised form (no link to your identity)

### 7.4 Right to Withdraw Consent
You may stop using the platform at any time. Since we do not rely on consent for marketing or profiling, there is no separate consent to withdraw — simply stop using the service and request account deletion.

### 7.5 Right to Grievance Redressal
You have the right to raise a grievance with our Grievance Officer (see Section 11). If your grievance is unresolved, you may escalate to the appropriate authority under the DPDP Act 2023 once the enforcement mechanism is notified by the Central Government.

---

## 8. Annual User Notification — Rule 3(1)(c)

As required under **Rule 3(1)(c)** of the IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, RajkotMarket will notify all registered users **at least once per year** of:

- Our current rules and regulations, privacy policy, and user agreement
- The categories of content that are not permitted on the platform
- The fact that access to the platform may be terminated if these rules are violated

This notification will be sent via SMS or email to your registered contact details.

---

## 9. Content Removal & Law Enforcement Obligations

### 9.1 Court and Government Orders — Rule 3(1)(d)
RajkotMarket will comply with any valid order from a court of competent jurisdiction or a notified government authority. Content or access specified in such an order will be removed or disabled within **36 hours** of receipt of the order.

### 9.2 Sexual or Intimate Content — Rule 3(2)
Any complaint regarding content that is sexually explicit or that depicts a person's private act without consent will be acknowledged within **24 hours** and the content removed or disabled within **24 hours** of the complaint being verified.

### 9.3 Preservation for Investigation — Rule 3(1)(g)
Any content that is removed or access to which is disabled will be preserved in its original form (without destroying evidentiary value) for a period of **180 days** for investigation purposes, or longer if directed by a court or government authority.

### 9.4 Government Information Requests — Rule 3(1)(j)
RajkotMarket will respond to any information request from a government agency or law enforcement authority within **72 hours** of receipt. Emergency requests (imminent threat to life or public safety) will be treated with priority.

### 9.5 Prohibited Content
RajkotMarket prohibits users from publishing, uploading, or transmitting content that is:
- Obscene, pornographic, or paedophilic
- Invasive of another person's privacy
- Harmful to minors or children
- Infringing intellectual property rights
- False, misleading, or fabricated information intended to deceive
- Impersonating another person or entity
- Threatening the unity, integrity, or security of India
- Containing malicious code or software
- Violating any applicable law

Full details of prohibited conduct are in our Terms and Conditions.

---

## 10. Children's Privacy

RajkotMarket is not intended for use by individuals under the age of **18**. We do not knowingly collect personal data from minors. If we become aware that a minor has registered on the platform, we will delete their account and associated data promptly.

If you believe a child has registered, please contact the Grievance Officer immediately.

---

## 11. Data Transfers

Your data is stored on **Supabase** infrastructure, which may operate servers in multiple regions including outside India. Order backup files are stored on **Google Drive** (Google LLC servers). By using RajkotMarket, you acknowledge that your data may be processed in these environments.

We ensure that these service providers maintain appropriate security standards through their published certifications and compliance programs (Supabase — SOC 2 Type II; Google — ISO 27001, SOC 2/3).

---

## 12. Changes to This Policy

- We may update this Privacy Policy from time to time to reflect changes in our practices or applicable law
- The "Last Updated" date at the top will be revised whenever changes are made
- For any change, we will notify all registered users via SMS or email **at least once per year** as required by Rule 3(1)(c) of the IT Rules 2021
- For material changes, notification will be sent **at least 7 days** before the change takes effect
- Continued use of the platform after the effective date of a change constitutes acceptance of the updated policy

---

## 11. Grievance Officer — Rule 3(2)

As mandated under **Rule 3(2)** of the Information Technology (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021:

**Name:** [Insert Grievance Officer's full name — must be an individual residing in India]
**Designation:** Grievance Officer, RajkotMarket
**Platform:** RajkotMarket (marketplace909099.vercel.app)
**Email:** [Insert dedicated grievance email address]
**Contact Hours:** Monday to Saturday, 10:00 AM – 6:00 PM IST

**Acknowledgement:** Within **24 hours** of receipt of complaint
**Resolution:** Within **15 days** of receipt of complaint
**Sexual/intimate content removal:** Within **24 hours** of verified complaint

You may contact the Grievance Officer for:
- Any data access, correction, or deletion request
- Concerns about how your data is being handled
- Reporting a suspected data breach or misuse
- Any complaint relating to content published on the platform

> The Grievance Officer is an individual who is a resident of India, as required by the IT Rules 2021.

---

## 14. Summary at a Glance

| What | Answer |
|---|---|
| Do we sell your data? | No |
| Do we use advertising trackers? | No |
| Do we use cookies? | No |
| Do we store your password? | No — customers use OTP only; vendor/admin passwords are bcrypt-hashed |
| Do we store raw session tokens? | No — only SHA-256 hashes stored in the database |
| Do we track your location (GPS)? | No |
| Do we share data with vendors? | Only delivery address and contact info needed to fulfil your order |
| Can you delete your account? | Yes — data deleted after 180-day legal hold |
| Grievance acknowledgement time | 24 hours |
| Grievance resolution time | 15 days |
| Data retained after deletion | 180 days (legal requirement), then permanently deleted |
| Annual policy notification | Yes — sent to all users at least once per year |
| Governing law | India — IT Act 2000, IT Rules 2021, DPDP Act 2023 |
