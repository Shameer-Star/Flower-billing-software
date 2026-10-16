# Flower-billing-software
# 🌸 Fresh Blooms - Flower Shop Billing & Customer Management System

> **Manage Your Flowers | Track Your Customers | Grow Your Business**

Fresh Blooms is a modern, fast, and professional billing, inventory, and customer management application built specifically for retail and wholesale flower businesses.

---

## ✨ Features

- **🔐 Multi-Role Authentication & Access Control (RBAC)**:
  - **Admin / Owner**: Full access to all operations, staff management, sales analytics, profit estimation, and store settings.
  - **Manager**: Daily billing, inventory inward movements, customer database management, and sales reports.
  - **Billing Staff / Cashier**: Fast invoice generation, customer search, cash/UPI collection, and receipt printing.
  - **Stock Manager**: Inward flower stock purchases, supplier records, spoilage/wastage deductions, and inventory reports.
  - **Quick Staff PIN**: Instant login via 4-digit authorized PIN (`1234`, `2345`, `3456`, `4567`).

- **⚡ High-Speed Flower Billing**:
  - Customer search with autocomplete by name or mobile number.
  - Auto-detection of customer categories: *Wholesale*, *Retail*, *Event Planner*, *Regular Buyer*.
  - Live customer credit alert and purchase history summary.
  - Dynamic flower item rows with auto-populated selling rates per kg or bundle.
  - Weight-based calculation in kilograms (kg) and grams.
  - Real-time Subtotal, Discounts, Additional Charges, Grand Total, and Balance Due calculation.
  - Multiple payment methods: Cash, UPI, Card, Bank Transfer, or Credit.

- **🖨️ Professional Tax Invoice & Receipts**:
  - Full tax invoice layout with shop header, GSTIN, invoice number, itemized rows, and signature line.
  - **Print Invoice**: Optimized via `@media print` for standard paper or POS thermal printers.
  - **Download PDF**: Instant PDF export.
  - **Share on WhatsApp**: One-click sharing that formats an invoice summary and launches WhatsApp directly.

- **👥 Customer Management & Credit Ledger**:
  - Full customer profiles with lifetime statistics: Total Purchased, Total Kilograms, Total Paid, and Outstanding Balance.
  - Purchase history with line-item detail.
  - Frequently purchased flower varieties.
  - **Settle Balance**: Settle credit balances with payment receipt logging.

- **🌺 Flower Inventory & Spoilage Tracking**:
  - Flower catalog tracking Jasmine, Rose, Marigold, Chrysanthemum, Lotus, Tuberose, Lily, Orchids, etc.
  - Real-time stock levels with minimum stock alert badges.
  - Inward stock purchase recording with grower/supplier details.
  - Spoilage/wastage logging for wilted or damaged petals.
  - Complete stock movement audit history.

- **📊 Dashboard, Reports & Analytics**:
  - 8 KPI cards: Today's Sales, Total Bills, Cash Collected, UPI Collection, Credit Sales, Outstanding Balances, Flowers Sold by weight, and Current Stock Value.
  - Interactive Sales Overview chart (Daily, Weekly, Monthly views).
  - Flower-wise sales breakdown (Donut chart).
  - Estimated Gross Profit calculation with explicit disclaimer.
  - One-click export to **Excel (.xls)**, **CSV**, and **PDF**.

---

## 🛠️ Tech Stack

- **Backend**: Node.js & Express REST API
- **Database**: Relational SQLite (`sql.js`) with ACID transactions and disk persistence
- **Security**: Password hashing with `bcryptjs`, JWT session tokens
- **Frontend**: Vanilla HTML5, Vanilla CSS3 (Custom design system), Vanilla JavaScript (ES6+)
- **Visuals & Charts**: Chart.js, Canvas Confetti

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18 or higher recommended)
- [Git](https://git-scm.com/)

### Installation

1. **Clone the repository:**
   ```bash
   git clone https://github.com/Shameer-Star/Flower-billing-software.git
   cd Flower-billing-software
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Start the application:**
   ```bash
   npm start
   ```

4. **Open in your browser:**
   ```
   http://localhost:3000
   ```

---

## 🔑 Demo Login Credentials

| Role | Username | Mobile | Password | Quick PIN |
| :--- | :--- | :--- | :--- | :--- |
| **Admin / Owner** | `admin` | `9876543210` | `admin123` | `1234` |
| **Manager** | `manager` | `9876543211` | `admin123` | `2345` |
| **Billing Staff / Cashier** | `cashier` | `9876543212` | `admin123` | `3456` |
| **Stock Manager** | `stockmgr` | `9876543213` | `admin123` | `4567` |

---

## 📁 Project Structure

```
├── data/
│   └── fresh_blooms.sqlite   # Relational SQLite database file
├── public/
│   ├── index.html            # Main SPA interface & modals
│   ├── style.css             # Vanilla CSS design system & print styles
│   └── app.js                # Frontend application logic & state management
├── db.js                     # SQLite initialization, schema & seed data
├── server.js                 # Express server & REST API
├── package.json
└── README.md
```

---

## 📄 License

This project is licensed under the ISC License.
