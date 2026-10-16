const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js');
const bcrypt = require('bcryptjs');

const DB_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'fresh_blooms.sqlite');

let db = null;
let SQL = null;

// Ensure data folder exists
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

// Save database to disk
function saveDb() {
  if (!db) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
  } catch (err) {
    console.error('Failed to persist database to disk:', err);
  }
}

// Helper to run query with params
function run(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  db.run(sql, params);
  saveDb();
}

// Helper to query multiple rows as objects
function query(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

// Helper to query single row as object
function queryOne(sql, params = []) {
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Initialize and seed database if new
async function initDatabase() {
  SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(fileBuffer);
    console.log('Loaded existing database from', DB_FILE);
  } else {
    db = new SQL.Database();
    console.log('Creating new fresh database schema and seeding initial data...');
    createSchemaAndSeed();
  }
  return db;
}

function createSchemaAndSeed() {
  // Create tables
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      mobile TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      pin TEXT,
      active INTEGER DEFAULT 1,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      mobile TEXT NOT NULL UNIQUE,
      shop_name TEXT,
      address TEXT,
      category TEXT NOT NULL,
      total_purchased REAL DEFAULT 0,
      total_weight REAL DEFAULT 0,
      total_paid REAL DEFAULT 0,
      outstanding REAL DEFAULT 0,
      last_purchase_date TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS flowers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      variety TEXT NOT NULL,
      unit TEXT DEFAULT 'kg',
      available_stock REAL DEFAULT 0,
      min_stock REAL DEFAULT 5,
      selling_rate REAL NOT NULL,
      purchase_cost REAL NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_no TEXT UNIQUE NOT NULL,
      customer_id TEXT,
      customer_name TEXT NOT NULL,
      customer_mobile TEXT NOT NULL,
      customer_category TEXT NOT NULL,
      subtotal REAL NOT NULL,
      discount REAL DEFAULT 0,
      additional_charges REAL DEFAULT 0,
      total_amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      amount_received REAL NOT NULL,
      balance_due REAL DEFAULT 0,
      payment_status TEXT NOT NULL,
      notes TEXT,
      created_by TEXT NOT NULL,
      created_by_role TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS invoice_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_id INTEGER NOT NULL,
      flower_id INTEGER,
      flower_name TEXT NOT NULL,
      variety TEXT NOT NULL,
      weight REAL NOT NULL,
      unit TEXT DEFAULT 'kg',
      rate REAL NOT NULL,
      amount REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS stock_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      flower_id INTEGER,
      flower_name TEXT NOT NULL,
      variety TEXT NOT NULL,
      type TEXT NOT NULL,
      weight REAL NOT NULL,
      rate REAL DEFAULT 0,
      total_cost REAL DEFAULT 0,
      supplier TEXT,
      reason TEXT,
      invoice_no TEXT,
      recorded_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_no TEXT UNIQUE NOT NULL,
      customer_id TEXT NOT NULL,
      customer_name TEXT NOT NULL,
      invoice_no TEXT,
      amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      notes TEXT,
      recorded_by TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_name TEXT NOT NULL,
      user_role TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  // Default Settings matching the prompt and screenshot
  const settings = [
    ['shop_name', 'Fresh Blooms'],
    ['tagline', 'Flower Shop Billing & Customer Management System'],
    ['address', '125 Flower Street, Koyambedu Flower Market, Chennai - 600001'],
    ['phone', '+91 98765 43210'],
    ['email', 'contact@freshblooms.in'],
    ['gstin', '33ABCDE1234F1Z5'],
    ['currency', '₹'],
    ['invoice_prefix', 'FB'],
    ['next_invoice_num', '1568'],
    ['footer_note', 'Thank you for choosing Fresh Blooms! Fresh Flowers • Happy Customers • Better Business']
  ];
  for (const [k, v] of settings) {
    db.run('INSERT INTO settings (key, value) VALUES (?, ?)', [k, v]);
  }

  // Seed Users (hashed password 'admin123', PIN '1234')
  const defaultPw = bcrypt.hashSync('admin123', 8);
  const now = new Date().toISOString();

  const users = [
    ['admin', '9876543210', 'Aravind Swaminathan (Owner)', 'admin', defaultPw, '1234', now],
    ['manager', '9876543211', 'Priya Sundaram', 'manager', defaultPw, '2345', now],
    ['cashier', '9876543212', 'Karthik Raja', 'cashier', defaultPw, '3456', now],
    ['stockmgr', '9876543213', 'Murugan Velu', 'stock_manager', defaultPw, '4567', now]
  ];
  for (const u of users) {
    db.run('INSERT INTO users (username, mobile, name, role, password_hash, pin, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', u);
  }

  // Seed Customers matching screenshot (C001 to C005)
  const customers = [
    ['C001', 'Sree Flowers', '9876543210', 'Sree Garlands & Traders', 'Shop #14, Flower Bazaar, Chennai', 'Wholesale', 18450, 45.5, 16450, 2000, '2026-10-15', now],
    ['C002', 'Anitha Events', '9845123410', 'Anitha Royal Weddings', '42 Anna Nagar 2nd Ave, Chennai', 'Event Planner', 12600, 31.0, 12600, 0, '2026-10-10', now],
    ['C003', 'Ramesh', '9798765432', 'Ramesh Puja Stores', '7 Sannadhi St, Mylapore, Chennai', 'Retail', 8250, 22.4, 7750, 500, '2026-10-08', now],
    ['C004', 'Green Garden', '9654321976', 'Green Garden Florals', '29 GST Road, Tambaram, Chennai', 'Wholesale', 6820, 19.8, 6820, 0, '2026-10-05', now],
    ['C005', 'Lakshmi', '9789012345', 'Sri Devi Temple Supplies', '18 Car Street, Triplicane, Chennai', 'Regular Buyer', 5980, 16.5, 5680, 300, '2026-10-02', now]
  ];
  for (const c of customers) {
    db.run('INSERT INTO customers (id, name, mobile, shop_name, address, category, total_purchased, total_weight, total_paid, outstanding, last_purchase_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', c);
  }

  // Seed Flowers matching screenshot catalog
  const flowers = [
    ['Jasmine', 'Mogra', 'kg', 25.5, 5, 400, 310, now],
    ['Rose', 'Red Rose', 'kg', 18.2, 5, 250, 190, now],
    ['Marigold', 'Local Yellow', 'kg', 12.6, 5, 180, 120, now],
    ['Chrysanthemum', 'White Sevvanthi', 'kg', 8.3, 5, 220, 160, now],
    ['Lotus', 'Pink Sacred', 'kg', 6.7, 3, 350, 260, now],
    ['Tuberose', 'Single Fragrant', 'kg', 4.5, 3, 280, 200, now],
    ['Lily', 'Oriental Pink', 'kg', 10.2, 5, 480, 360, now],
    ['Marigold', 'Orange Hybrid', 'kg', 14.0, 5, 190, 130, now],
    ['Orchids', 'Purple Mokara', 'kg', 5.0, 2, 650, 480, now]
  ];
  for (const f of flowers) {
    db.run('INSERT INTO flowers (name, variety, unit, available_stock, min_stock, selling_rate, purchase_cost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', f);
  }

  // Seed recent stock movements matching screenshot
  const movements = [
    [1, 'Jasmine', 'Mogra', 'Purchase', 50.0, 320, 16000, 'Green Farm Hosur', 'Fresh Morning Harvest', null, 'Murugan Velu', '2026-10-15 06:30:00'],
    [2, 'Rose', 'Red Rose', 'Purchase', 40.0, 210, 8400, 'Flower Traders Nilgiris', 'Direct Plantation Delivery', null, 'Murugan Velu', '2026-10-12 07:15:00'],
    [3, 'Marigold', 'Local Yellow', 'Purchase', 30.0, 120, 3600, 'Salem Growers Guild', 'Weekly stock batch', null, 'Murugan Velu', '2026-10-10 08:00:00'],
    [1, 'Jasmine', 'Mogra', 'Wastage', -2.0, 310, 620, null, 'Transit heat damage & wilting', null, 'Murugan Velu', '2026-10-14 18:00:00'],
    [3, 'Marigold', 'Local Yellow', 'Sale', -5.0, 180, 900, null, 'Invoice Sale', 'FB001560', 'Karthik Raja', '2026-10-10 11:30:00']
  ];
  for (const m of movements) {
    db.run('INSERT INTO stock_movements (flower_id, flower_name, variety, type, weight, rate, total_cost, supplier, reason, invoice_no, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', m);
  }

  // Seed Invoices
  const invoices = [
    ['FB001560', 'C003', 'Ramesh', '9798765432', 'Retail', 900, 50, 0, 850, 'Cash', 850, 0, 'Paid', 'Morning temple delivery', 'Karthik Raja', 'cashier', '2026-10-10 11:30:00'],
    ['FB001561', 'C002', 'Anitha Events', '9845123410', 'Event Planner', 4500, 200, 100, 4400, 'UPI', 4400, 0, 'Paid', 'Stage backdrop garlands', 'Priya Sundaram', 'manager', '2026-10-12 14:20:00'],
    ['FB001562', 'C005', 'Lakshmi', '9789012345', 'Regular Buyer', 1600, 0, 0, 1600, 'Cash', 1300, 300, 'Partial', 'Remaining 300 to pay next Friday', 'Karthik Raja', 'cashier', '2026-10-13 09:10:00'],
    ['FB001563', 'C004', 'Green Garden', '9654321976', 'Wholesale', 3200, 100, 0, 3100, 'UPI', 3100, 0, 'Paid', 'Festive wholesale batch', 'Karthik Raja', 'cashier', '2026-10-14 16:45:00'],
    ['FB001564', 'C001', 'Sree Flowers', '9876543210', 'Wholesale', 6500, 300, 0, 6200, 'Credit', 4200, 2000, 'Partial', 'Advance 4200 given, balance 2000 due', 'Aravind Swaminathan (Owner)', 'admin', '2026-10-15 10:15:00'],
    ['FB001565', 'C003', 'Ramesh', '9798765432', 'Retail', 2150, 50, 0, 2100, 'Cash', 1600, 500, 'Partial', 'Puja supplies on account', 'Karthik Raja', 'cashier', '2026-10-15 17:30:00'],
    ['FB001566', 'C002', 'Anitha Events', '9845123410', 'Event Planner', 8200, 250, 150, 8100, 'Bank Transfer', 8100, 0, 'Paid', 'Hall decoration flowers', 'Priya Sundaram', 'manager', '2026-10-16 08:45:00'],
    ['FB001567', 'C001', 'Sree Flowers', '9876543210', 'Wholesale', 3110, 100, 0, 3010, 'Cash', 3010, 0, 'Paid', 'Matching billing screen reference', 'Karthik Raja', 'cashier', '2026-10-16 11:45:00']
  ];
  for (const inv of invoices) {
    db.run(`INSERT INTO invoices (invoice_no, customer_id, customer_name, customer_mobile, customer_category, subtotal, discount, additional_charges, total_amount, payment_method, amount_received, balance_due, payment_status, notes, created_by, created_by_role, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, inv);
  }

  // Invoice Items for FB001567 (matching screenshot item table: Jasmine 5kg 400 = 2000, Rose 3kg 250 = 750, Marigold 2kg 180 = 360)
  const items = [
    [8, 1, 'Jasmine', 'Mogra', 5.0, 'kg', 400, 2000],
    [8, 2, 'Rose', 'Red Rose', 3.0, 'kg', 250, 750],
    [8, 3, 'Marigold', 'Local Yellow', 2.0, 'kg', 180, 360],
    // items for earlier invoices
    [7, 1, 'Jasmine', 'Mogra', 10.0, 'kg', 400, 4000],
    [7, 7, 'Lily', 'Oriental Pink', 6.0, 'kg', 480, 2880],
    [7, 5, 'Lotus', 'Pink Sacred', 4.0, 'kg', 350, 1400],
    [5, 1, 'Jasmine', 'Mogra', 10.0, 'kg', 400, 4000],
    [5, 2, 'Rose', 'Red Rose', 6.0, 'kg', 250, 1500],
    [5, 3, 'Marigold', 'Local Yellow', 5.0, 'kg', 200, 1000]
  ];
  for (const it of items) {
    db.run('INSERT INTO invoice_items (invoice_id, flower_id, flower_name, variety, weight, unit, rate, amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', it);
  }

  // Seed Payments
  const payments = [
    ['REC-1001', 'C003', 'Ramesh', 'FB001560', 850, 'Cash', 'Full invoice settlement', 'Karthik Raja', '2026-10-10 11:30:00'],
    ['REC-1002', 'C002', 'Anitha Events', 'FB001561', 4400, 'UPI', 'Full invoice UPI settlement', 'Priya Sundaram', '2026-10-12 14:20:00'],
    ['REC-1003', 'C005', 'Lakshmi', 'FB001562', 1300, 'Cash', 'Partial payment on bill', 'Karthik Raja', '2026-10-13 09:10:00'],
    ['REC-1004', 'C004', 'Green Garden', 'FB001563', 3100, 'UPI', 'Full invoice UPI payment', 'Karthik Raja', '2026-10-14 16:45:00'],
    ['REC-1005', 'C001', 'Sree Flowers', 'FB001564', 4200, 'Credit', 'Initial payment on credit sale', 'Aravind Swaminathan (Owner)', '2026-10-15 10:15:00'],
    ['REC-1006', 'C003', 'Ramesh', 'FB001565', 1600, 'Cash', 'Partial payment on bill', 'Karthik Raja', '2026-10-15 17:30:00'],
    ['REC-1007', 'C002', 'Anitha Events', 'FB001566', 8100, 'Bank Transfer', 'NEFT Bank settlement', 'Priya Sundaram', '2026-10-16 08:45:00'],
    ['REC-1008', 'C001', 'Sree Flowers', 'FB001567', 3010, 'Cash', 'Counter Cash Settlement', 'Karthik Raja', '2026-10-16 11:45:00']
  ];
  for (const p of payments) {
    db.run('INSERT INTO payments (receipt_no, customer_id, customer_name, invoice_no, amount, payment_method, notes, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', p);
  }

  // Seed Audit Logs
  const auditEntries = [
    ['System', 'system', 'Database Initialized', 'Fresh Blooms store database tables created', now],
    ['Murugan Velu', 'stock_manager', 'Stock Inward Recorded', 'Added 50kg Jasmine from Green Farm Hosur', '2026-10-15 06:30:00'],
    ['Aravind Swaminathan (Owner)', 'admin', 'Credit Sale Approved', 'Invoice FB001564 for Sree Flowers approved for 2000 credit', '2026-10-15 10:15:00'],
    ['Karthik Raja', 'cashier', 'Bill Generated', 'Generated Invoice FB001567 for Sree Flowers (₹3,010)', '2026-10-16 11:45:00']
  ];
  for (const a of auditEntries) {
    db.run('INSERT INTO audit_logs (user_name, user_role, action, details, created_at) VALUES (?, ?, ?, ?, ?)', a);
  }

  saveDb();
  console.log('Seeded database successfully with realistic flower shop data!');
}

module.exports = {
  initDatabase,
  run,
  query,
  queryOne,
  saveDb
};
