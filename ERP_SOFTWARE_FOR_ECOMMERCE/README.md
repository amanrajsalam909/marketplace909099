# RajkotMarket ERP — Desktop (Inventory & Products)

A professional offline desktop ERP for the RajkotMarket e-commerce platform.
It connects **directly to the live website's Supabase PostgreSQL database over the
internet** using JDBC, so stock and catalog changes you make here are immediately
reflected on the website (and vice-versa).

- **Language:** Java 21
- **UI:** JavaFX 21
- **Build:** Maven
- **Database:** PostgreSQL (the same Supabase DB the website uses) via JDBC + HikariCP

Modules: **Dashboard** (KPIs + charts), **Orders** (filters + detail), **Customers**
(CRM + order history), **Products & Inventory** (CRUD, audited stock adjustments,
per-product history, **Low Stock** view).

**Export:** Products, Orders and Customers each have an **⤓ Export** button that
saves the current (filtered) table to **Excel (.xlsx)**, **LibreOffice (.ods)**, or
**CSV** — pick the format in the Save dialog. Money/quantity columns are written as
real numbers so they sum correctly in the spreadsheet.

---

## 1. Prerequisites

- **Java 21** (JDK). Check with `java -version`.
- **Maven** (`mvn`). If you don't have it, see *Building without a system Maven* below.

## 2. Get your database connection details

In the **Supabase dashboard** for the project:

1. Click **Connect** (top bar).
2. Choose the **JDBC** tab → **Transaction pooler** (IPv4-friendly, port `6543`).
3. Copy the **host**, **user**, and your **database password**.

The app pre-fills sensible defaults for this project's pooler:

| Field    | Default                              |
|----------|--------------------------------------|
| Port     | `6543`                               |
| Database | `postgres`                           |
| User     | `postgres.gmnlckfrkxvfftiumhwf`      |
| Host     | *(paste from Supabase, e.g. `aws-0-ap-south-1.pooler.supabase.com`)* |
| Password | *(paste from Supabase)*              |

> The connection details are saved to `~/.rajkotmarket-erp/config.properties`
> on your machine — **never** committed to the repo.

## 3. Run

```bash
cd ERP_SOFTWARE_FOR_ECOMMERCE
mvn javafx:run
```

On first launch you'll see the **Connection** screen. Fill in the host and
password, click **Test & Connect**, and the main ERP window opens.

## 4. Build a distributable jar

```bash
mvn clean package
java -jar target/rajkotmarket-erp.jar
```

---

## Building without a system Maven

If `mvn` isn't installed, download Apache Maven once and point at it:

```bash
# example: extract a maven distribution anywhere, then
~/path/to/apache-maven/bin/mvn javafx:run
```

---

## Architecture

```
src/main/java/com/rajkotmarket/erp/
├── App.java / Launcher.java     entry points
├── config/AppConfig.java        loads/saves connection settings
├── db/Database.java             HikariCP pool to Supabase Postgres
├── model/                       Product, Vendor, InventoryMovement
├── dao/                         ProductDao, VendorDao, InventoryDao
└── ui/                          ConnectionController, MainController, ProductsController
src/main/resources/
├── fxml/                        connection / main / products views
└── css/app.css                  theme
```

### How stock changes stay safe
Stock adjustments run in a single transaction that locks the product row
(`SELECT … FOR UPDATE`), updates `products.stock`, and writes an audit row to
`inventory_log` — the **same pattern the website's checkout uses** — so a manual
adjustment here can never race with a live customer order. The database
`CHECK (stock >= 0)` constraint prevents overselling.

> Editing a product here does **not** change its stock; use **Adjust Stock** so
> every movement is recorded in the audit log.
