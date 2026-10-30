const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const { localDate, addDays, daysBetween } = require('./dates');

const IS_VERCEL = !!process.env.VERCEL;
const BUNDLED_DB_FILE = path.join(__dirname, 'data', 'fresh_blooms.sqlite');
const DB_FILE = process.env.DB_PATH || (IS_VERCEL ? path.join('/tmp', 'data', 'fresh_blooms.sqlite') : BUNDLED_DB_FILE);
const DB_DIR = path.dirname(DB_FILE);

const REVIEW_CYCLE_DAYS = parseInt(process.env.LOCATION_REVIEW_CYCLE_DAYS, 10) || 15;
const DUE_SOON_DAYS = 3;

// Engine state
let engine = null; // 'node:sqlite' or 'sql.js'
let db = null;
let txDepth = 0;
let inTransaction = false;
const statements = new Map();

// Detect node:sqlite
let NodeSqliteDatabaseSync = null;
try {
  const nodeSqlite = require('node:sqlite');
  if (nodeSqlite && nodeSqlite.DatabaseSync) {
    NodeSqliteDatabaseSync = nodeSqlite.DatabaseSync;
  }
} catch (e) {
  // node:sqlite not available on this Node version
}

function bind(params) {
  return params.map(v => (v === undefined ? null : typeof v === 'boolean' ? (v ? 1 : 0) : v));
}

// sql.js helper to save to disk
function saveDbIfSqlJs() {
  if (engine !== 'sql.js' || !db || inTransaction) return;
  try {
    const data = db.export();
    fs.writeFileSync(DB_FILE, Buffer.from(data));
  } catch (err) {
    console.error('[Database] Failed to persist sql.js database:', err);
  }
}

// Initialize database
async function initDatabase() {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) {
    try {
      fs.mkdirSync(DB_DIR, { recursive: true });
    } catch (err) {
      console.warn('[Database] Could not create DB_DIR:', err);
    }
  }

  // On Vercel, copy bundled database to /tmp if absent
  if (IS_VERCEL && !process.env.DB_PATH && !fs.existsSync(DB_FILE) && fs.existsSync(BUNDLED_DB_FILE)) {
    try {
      fs.copyFileSync(BUNDLED_DB_FILE, DB_FILE);
      console.log('[Database] Seeded SQLite database into /tmp from bundle');
    } catch (err) {
      console.warn('[Database] Failed to seed /tmp database:', err);
    }
  }

  // Attempt node:sqlite first if available
  if (NodeSqliteDatabaseSync) {
    try {
      db = new NodeSqliteDatabaseSync(DB_FILE);
      engine = 'node:sqlite';
      db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
      `);
      console.log('[Database] Opened via node:sqlite at', DB_FILE);
    } catch (err) {
      console.warn('[Database] node:sqlite failed to open file, falling back to sql.js:', err.message);
      db = null;
      engine = null;
    }
  }

  // Fallback to sql.js inline wasm
  if (!db) {
    const initSqlJs = require('sql.js/dist/sql-wasm-inline.js');
    const SQL = await initSqlJs();
    if (fs.existsSync(DB_FILE)) {
      try {
        const fileBuffer = fs.readFileSync(DB_FILE);
        db = new SQL.Database(fileBuffer);
      } catch (err) {
        console.warn('[Database] Could not read existing DB file, creating fresh database:', err);
        db = new SQL.Database();
      }
    } else {
      db = new SQL.Database();
    }
    engine = 'sql.js';
    saveDbIfSqlJs();
    console.log('[Database] Opened via sql.js (inline WASM) at', DB_FILE);
  }

  applyMigrations();
  provisionInitialAdmin();
  seedBuyersAndDistributions();
  refreshLocationReviewStatuses();

  return db;
}

function closeDatabase() {
  if (!db) return;
  if (engine === 'node:sqlite') {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch (e) {}
    statements.clear();
    db.close();
  } else if (engine === 'sql.js') {
    saveDbIfSqlJs();
    db.close();
  }
  db = null;
  engine = null;
}

function exec(sql) {
  if (!db) throw new Error('Database not initialized');
  if (engine === 'node:sqlite') {
    db.exec(sql);
  } else {
    db.run(sql);
    saveDbIfSqlJs();
  }
}

function run(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  const bound = bind(params);
  if (engine === 'node:sqlite') {
    let stmt = statements.get(sql);
    if (!stmt) {
      if (statements.size > 500) statements.clear();
      stmt = db.prepare(sql);
      statements.set(sql, stmt);
    }
    return stmt.run(...bound);
  } else {
    const stmt = db.prepare(sql);
    stmt.bind(bound);
    stmt.step();
    stmt.free();
    saveDbIfSqlJs();
    return { changes: 1 };
  }
}

function query(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  const bound = bind(params);
  if (engine === 'node:sqlite') {
    let stmt = statements.get(sql);
    if (!stmt) {
      if (statements.size > 500) statements.clear();
      stmt = db.prepare(sql);
      statements.set(sql, stmt);
    }
    return stmt.all(...bound);
  } else {
    const stmt = db.prepare(sql);
    stmt.bind(bound);
    const rows = [];
    while (stmt.step()) {
      rows.push(stmt.getAsObject());
    }
    stmt.free();
    return rows;
  }
}

function queryOne(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  const bound = bind(params);
  if (engine === 'node:sqlite') {
    let stmt = statements.get(sql);
    if (!stmt) {
      if (statements.size > 500) statements.clear();
      stmt = db.prepare(sql);
      statements.set(sql, stmt);
    }
    return stmt.get(...bound) || null;
  } else {
    const rows = query(sql, params);
    return rows.length > 0 ? rows[0] : null;
  }
}

function transaction(fn) {
  if (!db) throw new Error('Database not initialized');
  if (txDepth > 0) return fn();

  if (engine === 'node:sqlite') {
    db.exec('BEGIN IMMEDIATE;');
    txDepth++;
    try {
      const result = fn();
      db.exec('COMMIT;');
      return result;
    } catch (err) {
      try { db.exec('ROLLBACK;'); } catch (rbErr) {}
      throw err;
    } finally {
      txDepth--;
    }
  } else {
    inTransaction = true;
    txDepth++;
    db.run('BEGIN TRANSACTION;');
    try {
      const result = fn();
      db.run('COMMIT;');
      inTransaction = false;
      txDepth--;
      saveDbIfSqlJs();
      return result;
    } catch (err) {
      inTransaction = false;
      txDepth--;
      try { db.run('ROLLBACK;'); } catch (rbErr) {}
      throw err;
    }
  }
}

function tableColumns(table) {
  try {
    return query(`PRAGMA table_info(${table})`).map(c => c.name);
  } catch (e) {
    return [];
  }
}

function addColumnIfMissing(table, column, definition) {
  const cols = tableColumns(table);
  if (cols.length > 0 && !cols.includes(column)) {
    try {
      exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition};`);
      console.log(`[Migration] Added ${table}.${column}.`);
    } catch (err) {
      console.warn(`[Migration] Could not add ${table}.${column}:`, err.message);
    }
  }
}

function applyMigrations() {
  exec(`
    -- Users Table
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'staff',
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Farmers Table
    CREATE TABLE IF NOT EXISTS farmers (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      name_ta TEXT,
      contact_number TEXT UNIQUE NOT NULL,
      village TEXT NOT NULL,
      village_ta TEXT,
      address TEXT,
      district TEXT DEFAULT 'Kanyakumari',
      state TEXT DEFAULT 'Tamil Nadu',
      latitude REAL,
      longitude REAL,
      location_source TEXT DEFAULT 'manual',
      location_review_status TEXT NOT NULL DEFAULT 'unavailable',
      last_location_reviewed_at TEXT,
      next_location_review_due_at TEXT,
      status TEXT NOT NULL DEFAULT 'active',
      total_collected_kg REAL NOT NULL DEFAULT 0,
      total_payout REAL NOT NULL DEFAULT 0,
      is_synthetic INTEGER NOT NULL DEFAULT 0,
      notes TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Farmer Location History
    CREATE TABLE IF NOT EXISTS farmer_locations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      farmer_id TEXT NOT NULL REFERENCES farmers(id) ON DELETE CASCADE,
      collection_id TEXT,
      latitude REAL NOT NULL,
      longitude REAL NOT NULL,
      village TEXT,
      address TEXT,
      source TEXT NOT NULL,
      verification_status TEXT NOT NULL,
      verified_by TEXT,
      capture_timestamp TEXT NOT NULL,
      review_notes TEXT,
      created_at TEXT NOT NULL
    );

    -- Collections (Flower Purchases)
    CREATE TABLE IF NOT EXISTS collections (
      id TEXT PRIMARY KEY,
      farmer_id TEXT NOT NULL REFERENCES farmers(id) ON DELETE RESTRICT,
      farmer_name TEXT NOT NULL,
      farmer_village TEXT NOT NULL,
      collection_date TEXT NOT NULL,
      flower_type TEXT NOT NULL,
      variety TEXT,
      quantity_kg REAL NOT NULL,
      rate_per_kg REAL NOT NULL,
      total_amount REAL NOT NULL,
      applicable_charges REAL NOT NULL DEFAULT 0,
      net_amount REAL NOT NULL DEFAULT 0,
      quality_grade TEXT DEFAULT 'Grade A',
      payment_status TEXT NOT NULL DEFAULT 'Pending',
      payment_mode TEXT DEFAULT 'Cash',
      amount_paid REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      cancellation_reason TEXT,
      notes TEXT,
      collected_by TEXT NOT NULL,
      client_ref TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- 15-Day Automated System Audits (Append-Only)
    CREATE TABLE IF NOT EXISTS system_audits (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_uuid TEXT UNIQUE NOT NULL,
      audit_date TEXT NOT NULL,
      trigger_type TEXT NOT NULL,
      execution_status TEXT NOT NULL,
      summary_counts TEXT,
      next_scheduled_audit_date TEXT NOT NULL,
      executed_by TEXT NOT NULL,
      execution_time_ms INTEGER,
      created_at TEXT NOT NULL
    );

    -- Audit Findings (Issues found during 15-day audits, with resolution workflow)
    CREATE TABLE IF NOT EXISTS audit_findings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      audit_id INTEGER REFERENCES system_audits(id),
      category TEXT NOT NULL,
      severity TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      check_name TEXT NOT NULL,
      description TEXT NOT NULL,
      recommended_action TEXT NOT NULL,
      resolution_status TEXT NOT NULL DEFAULT 'UNRESOLVED',
      resolution_notes TEXT,
      resolved_by TEXT,
      resolved_at TEXT,
      created_at TEXT NOT NULL
    );

    -- Synchronization Events (Real-time multi-device sync)
    CREATE TABLE IF NOT EXISTS sync_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      event_id TEXT UNIQUE NOT NULL,
      event_type TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      payload TEXT NOT NULL,
      client_id TEXT,
      created_at TEXT NOT NULL
    );

    -- Append-Only Audit Trail Logs
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      actor_name TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT,
      details TEXT NOT NULL,
      before_state TEXT,
      after_state TEXT,
      ip_address TEXT
    );

    -- Application Settings
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT
    );

    -- Id Sequences (FAR-1001, COL-2026-1001, INV-2026-1001)
    CREATE TABLE IF NOT EXISTS sequences (
      name TEXT PRIMARY KEY,
      value INTEGER NOT NULL
    );
    -- Buyers Table (Wholesale Selling Module)
    CREATE TABLE IF NOT EXISTS buyers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      name_ta TEXT,
      contact_person TEXT,
      phone TEXT NOT NULL,
      market_city TEXT NOT NULL DEFAULT 'Madurai',
      address TEXT,
      credit_limit REAL DEFAULT 100000,
      outstanding_balance REAL DEFAULT 0,
      billing_cycle_days INTEGER DEFAULT 6,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Buyer Flower Distributions (Tracked from Procurement Locations)
    CREATE TABLE IF NOT EXISTS buyer_distributions (
      id TEXT PRIMARY KEY,
      distribution_date TEXT NOT NULL,
      buyer_id TEXT NOT NULL REFERENCES buyers(id),
      buyer_name TEXT NOT NULL,
      procurement_location TEXT NOT NULL,
      flower_type TEXT NOT NULL,
      variety TEXT,
      quantity_kg REAL NOT NULL,
      rate_per_kg REAL NOT NULL,
      total_amount REAL NOT NULL,
      coolie_charges REAL NOT NULL DEFAULT 0,
      transport_charges REAL NOT NULL DEFAULT 0,
      dispatch_status TEXT NOT NULL DEFAULT 'delivered',
      bill_status TEXT NOT NULL DEFAULT 'unbilled',
      selling_bill_id TEXT REFERENCES selling_bills(id),
      vehicle_number TEXT,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Consolidated 5-6 Day Selling Bills
    CREATE TABLE IF NOT EXISTS selling_bills (
      id TEXT PRIMARY KEY,
      bill_number TEXT NOT NULL,
      buyer_id TEXT NOT NULL REFERENCES buyers(id),
      buyer_name TEXT NOT NULL,
      billing_cycle_days INTEGER NOT NULL DEFAULT 6,
      period_start_date TEXT NOT NULL,
      period_end_date TEXT NOT NULL,
      bill_date TEXT NOT NULL,
      total_kg REAL NOT NULL,
      gross_flower_amount REAL NOT NULL,
      coolie_charges REAL NOT NULL DEFAULT 0,
      transport_charges REAL NOT NULL DEFAULT 0,
      other_charges REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      subtotal_amount REAL NOT NULL,
      previous_balance REAL NOT NULL DEFAULT 0,
      total_payable REAL NOT NULL,
      amount_paid REAL NOT NULL DEFAULT 0,
      balance_due REAL NOT NULL,
      payment_status TEXT NOT NULL DEFAULT 'Pending',
      payment_mode TEXT DEFAULT 'Cash',
      notes TEXT,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Selling Bill Itemized Breakdown
    CREATE TABLE IF NOT EXISTS selling_bill_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      selling_bill_id TEXT NOT NULL REFERENCES selling_bills(id) ON DELETE CASCADE,
      distribution_id TEXT,
      item_date TEXT NOT NULL,
      procurement_location TEXT NOT NULL,
      flower_type TEXT NOT NULL,
      variety TEXT,
      quantity_kg REAL NOT NULL,
      rate_per_kg REAL NOT NULL,
      total_amount REAL NOT NULL,
      coolie_charges REAL NOT NULL DEFAULT 0,
      transport_charges REAL NOT NULL DEFAULT 0
    );
  `);

  // Column additions for existing tables
  addColumnIfMissing('farmers', 'name_ta', 'TEXT');
  addColumnIfMissing('farmers', 'village_ta', 'TEXT');
  addColumnIfMissing('farmers', 'district', "TEXT DEFAULT 'Kanyakumari'");
  addColumnIfMissing('farmers', 'state', "TEXT DEFAULT 'Tamil Nadu'");
  addColumnIfMissing('farmers', 'location_source', "TEXT DEFAULT 'manual'");
  addColumnIfMissing('farmers', 'is_synthetic', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('farmers', 'version', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('farmers', 'billing_cycle_days', 'INTEGER NOT NULL DEFAULT 15');
  addColumnIfMissing('farmers', 'commission_rate', 'REAL NOT NULL DEFAULT 10.0');

  addColumnIfMissing('collections', 'client_ref', 'TEXT');
  addColumnIfMissing('collections', 'applicable_charges', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('collections', 'net_amount', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('collections', 'version', 'INTEGER NOT NULL DEFAULT 1');
  addColumnIfMissing('collections', 'gross_amount', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('collections', 'commission_rate', 'REAL NOT NULL DEFAULT 10.0');
  addColumnIfMissing('collections', 'commission_amount', 'REAL NOT NULL DEFAULT 0');

  exec(`
    CREATE INDEX IF NOT EXISTS idx_farmers_village ON farmers(village);
    CREATE INDEX IF NOT EXISTS idx_farmers_status ON farmers(status);
    CREATE INDEX IF NOT EXISTS idx_farmers_loc_status ON farmers(location_review_status);
    CREATE INDEX IF NOT EXISTS idx_collections_farmer ON collections(farmer_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_collections_client_ref ON collections(client_ref) WHERE client_ref IS NOT NULL;
    CREATE INDEX IF NOT EXISTS idx_locations_farmer ON farmer_locations(farmer_id);
    CREATE INDEX IF NOT EXISTS idx_collections_day_totals ON collections(collection_date, status, farmer_id, quantity_kg, total_amount);
    CREATE INDEX IF NOT EXISTS idx_locations_time_cover ON farmer_locations(capture_timestamp, farmer_id, latitude, longitude);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_findings_status ON audit_findings(resolution_status);
    CREATE INDEX IF NOT EXISTS idx_sync_events_id ON sync_events(id);
    CREATE INDEX IF NOT EXISTS idx_buyers_city ON buyers(market_city);
    CREATE INDEX IF NOT EXISTS idx_buyer_dist_date ON buyer_distributions(distribution_date, buyer_id);
    CREATE INDEX IF NOT EXISTS idx_buyer_dist_loc ON buyer_distributions(procurement_location);
    CREATE INDEX IF NOT EXISTS idx_selling_bills_buyer ON selling_bills(buyer_id);
    CREATE INDEX IF NOT EXISTS idx_selling_bills_date ON selling_bills(bill_date);
  `);

  // Default settings
  const defaultSettings = [
    ['system_name', 'Fresh Blooms - Flower Billing & Farmer Management'],
    ['organization_name', 'Fresh Blooms Floral Operations'],
    ['default_currency', '₹'],
    ['weight_unit', 'kg'],
    ['session_timeout_minutes', '120'],
    ['backup_retention_days', '90'],
    ['audit_interval_days', '15']
  ];
  for (const [key, val] of defaultSettings) {
    run('INSERT OR IGNORE INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [key, val, new Date().toISOString()]);
  }
}

function provisionInitialAdmin() {
  const adminCount = queryOne("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
  if (adminCount && adminCount.count > 0) {
    return;
  }

  const username = process.env.ADMIN_INITIAL_USERNAME || 'admin';
  const plainPassword = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@12345';
  const email = process.env.ADMIN_INITIAL_EMAIL || 'admin@freshblooms.com';
  const fullName = process.env.ADMIN_INITIAL_NAME || 'System Administrator';

  const hash = bcrypt.hashSync(plainPassword, 12);
  const now = new Date().toISOString();

  transaction(() => {
    run(`
      INSERT INTO users (username, email, full_name, role, password_hash, status, created_at, updated_at)
      VALUES (?, ?, ?, 'admin', ?, 'active', ?, ?)
    `, [username, email, fullName, hash, now, now]);

    run(`
      INSERT INTO audit_logs (timestamp, actor_id, actor_name, action, entity_type, entity_id, details)
      VALUES (?, 'SYSTEM', 'System Initializer', 'ADMIN_PROVISIONED', 'users', ?, 'Initial administrator account provisioned securely')
    `, [now, username]);
  });

  console.log(`[Security] Admin account provisioned for username: "${username}".`);
}

function seedBuyersAndDistributions() {
  const buyerCount = queryOne("SELECT COUNT(*) as count FROM buyers");
  if (buyerCount && buyerCount.count > 0) return;

  const SEED_BUYERS = [
    { id: 'BUY-1001', name: 'Sri Murugan Flower Mart', name_ta: 'ஸ்ரீ முருகன் பிளவர் மார்ட்', contact: 'K. Murugan', phone: '9840123456', city: 'Chennai', address: 'Shop 14, Flower Gate, Koyambedu Market', limit: 150000, cycle: 6, bal: 18450 },
    { id: 'BUY-1002', name: 'Meenakshi Malar Nilayam', name_ta: 'மீனாட்சி மலர் நிலையம்', contact: 'S. Sundaram', phone: '9842134567', city: 'Madurai', address: 'Block C, Mattuthavani Flower Market', limit: 120000, cycle: 5, bal: 24600 },
    { id: 'BUY-1003', name: 'Kannan Garlands & Florist', name_ta: 'கண்ணன் மாலை & பூக்கடை', contact: 'R. Kannan', phone: '9843245678', city: 'Trichy', address: '45 Gandhi Market West', limit: 80000, cycle: 6, bal: 9200 },
    { id: 'BUY-1004', name: 'Lakshmi Malar Kazhagam', name_ta: 'லட்சுமி மலர் கழகம்', contact: 'M. Lakshmi', phone: '9443156789', city: 'Coimbatore', address: 'Poo Market Complex, Mettupalayam Rd', limit: 200000, cycle: 6, bal: 38500 },
    { id: 'BUY-1005', name: 'Thovalai Malar Traders', name_ta: 'தோவாளை மலர் டிரேடர்ஸ்', contact: 'V. Arumugam', phone: '9442267890', city: 'Kanyakumari', address: 'Main Market Road, Thovalai', limit: 100000, cycle: 5, bal: 14200 },
    { id: 'BUY-1006', name: 'Senthil Kumaran Florists', name_ta: 'செந்தில் குமரன் பூவகம்', contact: 'P. Senthil', phone: '9894378901', city: 'Dindigul', address: 'Flower Market Stall 22, Dindigul', limit: 90000, cycle: 6, bal: 11000 },
    { id: 'BUY-1007', name: 'Raja Flower Stall', name_ta: 'ராஜா பூக்கடை', contact: 'A. Rajan', phone: '9841489012', city: 'Chennai', address: 'Badrian Street, George Town', limit: 110000, cycle: 5, bal: 16500 },
    { id: 'BUY-1008', name: 'Devi Floral Stores', name_ta: 'தேவி மலர் அங்காடி', contact: 'N. Devi', phone: '9444590123', city: 'Trivandrum', address: 'Flower Lane, Chala Market', limit: 140000, cycle: 6, bal: 22000 },
    { id: 'BUY-1009', name: 'Nilakottai Jasmine Center', name_ta: 'நிலக்கோட்டை மல்லிகை மையம்', contact: 'G. Pandian', phone: '9865601234', city: 'Dindigul', address: 'Batlagundu Road, Nilakottai', limit: 75000, cycle: 5, bal: 8500 },
    { id: 'BUY-1010', name: 'Thirumangalam Malar Traders', name_ta: 'திருமங்கலம் மலர் டிரேடர்ஸ்', contact: 'C. Mariappan', phone: '9486712345', city: 'Madurai', address: 'Usilai Road, Thirumangalam', limit: 85000, cycle: 6, bal: 12400 },
    { id: 'BUY-1011', name: 'Kovai Rose & Cutflowers', name_ta: 'கோவை ரோஸ் ஏஜென்சி', contact: 'K. Balakrishnan', phone: '9842823456', city: 'Coimbatore', address: 'Diwan Bahadur Rd, RS Puram', limit: 130000, cycle: 6, bal: 19800 },
    { id: 'BUY-1012', name: 'Salem Malar Mandi', name_ta: 'சேலம் மலர் மண்டி', contact: 'T. Rathinam', phone: '9843934567', city: 'Salem', address: 'Leigh Bazaar, Shevapet', limit: 95000, cycle: 5, bal: 15300 },
    { id: 'BUY-1013', name: 'Nellai Royal Flowers', name_ta: 'நெல்லை ராயல் பிளவர்ஸ்', contact: 'S. Subbiah', phone: '9443045678', city: 'Tirunelveli', address: 'High Grounds, Palayamkottai', limit: 70000, cycle: 6, bal: 7800 },
    { id: 'BUY-1014', name: 'Erode Fresh Bloom Suppliers', name_ta: 'ஈரோடு பிரஷ் பூ விநியோகம்', contact: 'E. Selvam', phone: '9842156780', city: 'Erode', address: 'Near Clock Tower, Municipal Market', limit: 80000, cycle: 5, bal: 13600 },
    { id: 'BUY-1015', name: 'Tanjore Temple Garlands', name_ta: 'தஞ்சாவூர் மாலை மையம்', contact: 'D. Govindan', phone: '9443267891', city: 'Thanjavur', address: 'South Rampart, Near Big Temple', limit: 65000, cycle: 6, bal: 9400 },
    { id: 'BUY-1016', name: 'Vellore Green Malar Agam', name_ta: 'வேலூர் மலர் அகம்', contact: 'M. Jeyakumar', phone: '9894378902', city: 'Vellore', address: 'Long Bazaar Main Rd', limit: 90000, cycle: 5, bal: 12100 },
    { id: 'BUY-1017', name: 'Nagercoil Malar Pannai', name_ta: 'நாகர்கோவில் மலர் பண்ணை', contact: 'J. Paulraj', phone: '9442489013', city: 'Kanyakumari', address: 'Vadasery Flower Market', limit: 115000, cycle: 6, bal: 17200 },
    { id: 'BUY-1018', name: 'Sathyamangalam Flower Hub', name_ta: 'சத்தியமங்கலம் மலர் மையம்', contact: 'R. Chinnasamy', phone: '9865590124', city: 'Erode', address: 'Bannari Amman Bypass Rd', limit: 85000, cycle: 6, bal: 10500 },
    { id: 'BUY-1019', name: 'Hosur Exotic Florals', name_ta: 'ஓசூர் எக்சோடிக் மலர்கள்', contact: 'B. Prakash', phone: '9840601235', city: 'Hosur', address: 'Bagalur Road Industrial Estate', limit: 250000, cycle: 6, bal: 42000 },
    { id: 'BUY-1020', name: 'Karur Malar Vanigam', name_ta: 'கரூர் மலர் வணிகம்', contact: 'P. Karuppasamy', phone: '9842712346', city: 'Karur', address: 'Central Bus Stand Market', limit: 70000, cycle: 5, bal: 6500 },
    { id: 'BUY-1021', name: 'Puducherry Grand Florals', name_ta: 'புதுச்சேரி கிராண்ட் மலர்', contact: 'S. Elangovan', phone: '9443823457', city: 'Pondicherry', address: 'Goubert Market, Rangapillai St', limit: 105000, cycle: 6, bal: 14700 },
    { id: 'BUY-1022', name: 'Sivakasi Malar Kalanjiyam', name_ta: 'சிவகாசி மலர் களஞ்சியம்', contact: 'M. Ganesan', phone: '9894934568', city: 'Virudhunagar', address: 'NRKR Road Commercial Complex', limit: 60000, cycle: 5, bal: 8900 },
    { id: 'BUY-1023', name: 'Kumbakonam Mahamaham Flowers', name_ta: 'கும்பகோணம் மகாமகம் மலர்கள்', contact: 'V. Subramani', phone: '9443045679', city: 'Thanjavur', address: 'Potramarai Tank West', limit: 75000, cycle: 6, bal: 11300 },
    { id: 'BUY-1024', name: 'Aruppukottai Malar Stall', name_ta: 'அருப்புக்கோட்டை மலர் ஸ்டால்', contact: 'A. Pandiyan', phone: '9842156782', city: 'Virudhunagar', address: 'Gandhi Nagar Main Market', limit: 65000, cycle: 5, bal: 7600 },
    { id: 'BUY-1025', name: 'Tiruppur Malar Export Centre', name_ta: 'திருப்பூர் மலர் எக்ஸ்போர்ட்', contact: 'T. Velmurugan', phone: '9843267893', city: 'Tiruppur', address: 'Kumaran Road Cotton Market', limit: 180000, cycle: 6, bal: 31000 }
  ];

  const now = new Date().toISOString();
  const today = localDate();

  transaction(() => {
    for (const b of SEED_BUYERS) {
      run(`
        INSERT INTO buyers (id, name, name_ta, contact_person, phone, market_city, address, credit_limit, outstanding_balance, billing_cycle_days, status, notes, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
      `, [b.id, b.name, b.name_ta, b.contact, b.phone, b.city, b.address, b.limit, b.bal, b.cycle, `Wholesale Buyer - ${b.city}`, now, now]);
    }

    const SAMPLE_DISTS = [
      // 6-day cycle batch for BUY-1001 (Chennai)
      { id: 'DIST-2026-1001', buyer_id: 'BUY-1001', buyer_name: 'Sri Murugan Flower Mart', date: addDays(today, -6), loc: 'Thovalai', flower: 'Jasmine', var: 'Premium Mogra', kg: 45.0, rate: 480, coolie: 150, trans: 300 },
      { id: 'DIST-2026-1002', buyer_id: 'BUY-1001', buyer_name: 'Sri Murugan Flower Mart', date: addDays(today, -5), loc: 'Hosur', flower: 'Rose', var: 'Dutch Red Rose', kg: 60.0, rate: 140, coolie: 120, trans: 250 },
      { id: 'DIST-2026-1003', buyer_id: 'BUY-1001', buyer_name: 'Sri Murugan Flower Mart', date: addDays(today, -4), loc: 'Nilakottai', flower: 'Jasmine', var: 'Madurai Malli', kg: 50.0, rate: 490, coolie: 150, trans: 300 },
      { id: 'DIST-2026-1004', buyer_id: 'BUY-1001', buyer_name: 'Sri Murugan Flower Mart', date: addDays(today, -3), loc: 'Sathyamangalam', flower: 'Marigold', var: 'Golden Yellow', kg: 80.0, rate: 65, coolie: 160, trans: 280 },
      { id: 'DIST-2026-1005', buyer_id: 'BUY-1001', buyer_name: 'Sri Murugan Flower Mart', date: addDays(today, -2), loc: 'Denkanikottai', flower: 'Chrysanthemum', var: 'White Button', kg: 40.0, rate: 110, coolie: 100, trans: 200 },
      { id: 'DIST-2026-1006', buyer_id: 'BUY-1001', buyer_name: 'Sri Murugan Flower Mart', date: addDays(today, -1), loc: 'Thovalai', flower: 'Crossandra', var: 'Firecracker Orange', kg: 15.0, rate: 550, coolie: 80, trans: 150 },

      // 5-day cycle batch for BUY-1002 (Madurai)
      { id: 'DIST-2026-1007', buyer_id: 'BUY-1002', buyer_name: 'Meenakshi Malar Nilayam', date: addDays(today, -5), loc: 'Nilakottai', flower: 'Jasmine', var: 'Gundu Malli', kg: 55.0, rate: 470, coolie: 140, trans: 200 },
      { id: 'DIST-2026-1008', buyer_id: 'BUY-1002', buyer_name: 'Meenakshi Malar Nilayam', date: addDays(today, -4), loc: 'Sankarankovil', flower: 'Lotus', var: 'Pink Sacred Lotus', kg: 25.0, rate: 160, coolie: 90, trans: 180 },
      { id: 'DIST-2026-1009', buyer_id: 'BUY-1002', buyer_name: 'Meenakshi Malar Nilayam', date: addDays(today, -3), loc: 'Thovalai', flower: 'Tuberose', var: 'Single Petal Fragrant', kg: 35.0, rate: 180, coolie: 110, trans: 190 },
      { id: 'DIST-2026-1010', buyer_id: 'BUY-1002', buyer_name: 'Meenakshi Malar Nilayam', date: addDays(today, -2), loc: 'Hosur', flower: 'Rose', var: 'Taj Mahal Red', kg: 45.0, rate: 145, coolie: 120, trans: 220 },
      { id: 'DIST-2026-1011', buyer_id: 'BUY-1002', buyer_name: 'Meenakshi Malar Nilayam', date: addDays(today, -1), loc: 'Sathyamangalam', flower: 'Marigold', var: 'Orange Bloom', kg: 70.0, rate: 60, coolie: 150, trans: 210 },

      // Recent unbilled distributions across other buyers
      { id: 'DIST-2026-1012', buyer_id: 'BUY-1003', buyer_name: 'Kannan Garlands & Florist', date: addDays(today, -2), loc: 'Thovalai', flower: 'Jasmine', var: 'First Cut', kg: 30.0, rate: 480, coolie: 100, trans: 180 },
      { id: 'DIST-2026-1013', buyer_id: 'BUY-1003', buyer_name: 'Kannan Garlands & Florist', date: addDays(today, -1), loc: 'Nilakottai', flower: 'Rose', var: 'Pink Rose', kg: 40.0, rate: 130, coolie: 110, trans: 190 },
      { id: 'DIST-2026-1014', buyer_id: 'BUY-1004', buyer_name: 'Lakshmi Malar Kazhagam', date: addDays(today, -2), loc: 'Hosur', flower: 'Chrysanthemum', var: 'Yellow Pompon', kg: 50.0, rate: 105, coolie: 120, trans: 200 },
      { id: 'DIST-2026-1015', buyer_id: 'BUY-1004', buyer_name: 'Lakshmi Malar Kazhagam', date: addDays(today, -1), loc: 'Sathyamangalam', flower: 'Marigold', var: 'Super Gold', kg: 90.0, rate: 58, coolie: 180, trans: 250 },
      { id: 'DIST-2026-1016', buyer_id: 'BUY-1005', buyer_name: 'Thovalai Malar Traders', date: today, loc: 'Thovalai', flower: 'Jasmine', var: 'Thovalai Special', kg: 25.0, rate: 510, coolie: 80, trans: 120 }
    ];

    for (const d of SAMPLE_DISTS) {
      const tot = Math.round(d.kg * d.rate * 100) / 100;
      run(`
        INSERT INTO buyer_distributions (
          id, distribution_date, buyer_id, buyer_name, procurement_location, flower_type, variety,
          quantity_kg, rate_per_kg, total_amount, coolie_charges, transport_charges,
          dispatch_status, bill_status, vehicle_number, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', 'unbilled', 'TN-74-B-8921', 'Direct procurement dispatch', ?, ?)
      `, [d.id, d.date, d.buyer_id, d.buyer_name, d.loc, d.flower, d.var, d.kg, d.rate, tot, d.coolie, d.trans, now, now]);
    }

    // Pre-create 1 sample consolidated 6-day selling bill for BUY-1001 (Chennai)
    const dists1 = SAMPLE_DISTS.slice(0, 6);
    const billId1 = 'SB-2026-1001';
    const periodStart1 = dists1[0].date;
    const periodEnd1 = dists1[5].date;
    let totalKg1 = 0;
    let flowerAmt1 = 0;
    let coolie1 = 0;
    let trans1 = 0;
    for (const d of dists1) {
      totalKg1 += d.kg;
      flowerAmt1 += Math.round(d.kg * d.rate * 100) / 100;
      coolie1 += d.coolie;
      trans1 += d.trans;
    }
    const subtotal1 = Math.round((flowerAmt1 + coolie1 + trans1) * 100) / 100;
    const prevBal1 = 12000;
    const grandTot1 = Math.round((subtotal1 + prevBal1) * 100) / 100;
    const paid1 = 60000;
    const balDue1 = Math.round((grandTot1 - paid1) * 100) / 100;

    run(`
      INSERT INTO selling_bills (
        id, bill_number, buyer_id, buyer_name, billing_cycle_days, period_start_date, period_end_date,
        bill_date, total_kg, gross_flower_amount, coolie_charges, transport_charges, other_charges,
        discount_amount, subtotal_amount, previous_balance, total_payable, amount_paid, balance_due,
        payment_status, payment_mode, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 6, ?, ?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?, ?, 'Partial', 'Bank Transfer', '6-Day Consolidated Cycle Settled via RTGS', 'Administrator', ?, ?)
    `, [billId1, 'SB-2026-1001', 'BUY-1001', 'Sri Murugan Flower Mart', periodStart1, periodEnd1, today, totalKg1, flowerAmt1, coolie1, trans1, subtotal1, prevBal1, grandTot1, paid1, balDue1, now, now]);

    for (const d of dists1) {
      const tot = Math.round(d.kg * d.rate * 100) / 100;
      run(`
        INSERT INTO selling_bill_items (selling_bill_id, distribution_id, item_date, procurement_location, flower_type, variety, quantity_kg, rate_per_kg, total_amount, coolie_charges, transport_charges)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [billId1, d.id, d.date, d.loc, d.flower, d.var, d.kg, d.rate, tot, d.coolie, d.trans]);

      run("UPDATE buyer_distributions SET bill_status = 'billed', selling_bill_id = ? WHERE id = ?", [billId1, d.id]);
    }
  });

  console.log('[Seed] 25 Wholesale Flower Buyers, Procurement Distributions, and Consolidated Selling Bills seeded successfully.');
}

function reviewStatusFor(farmer, today = localDate()) {
  if (farmer.latitude === null || farmer.longitude === null) {
    return { status: 'unavailable', nextDue: null };
  }
  const since = farmer.last_location_reviewed_at || localDate(new Date(farmer.created_at));
  const age = daysBetween(since, today);
  const status = age >= REVIEW_CYCLE_DAYS ? 'overdue'
    : age >= REVIEW_CYCLE_DAYS - DUE_SOON_DAYS ? 'due_soon'
    : 'verified';
  return { status, nextDue: addDays(since, REVIEW_CYCLE_DAYS) };
}

let statusesRefreshedOn = null;
function refreshLocationReviewStatuses(force = false) {
  const today = localDate();
  if (!force && statusesRefreshedOn === today) return 0;

  const farmers = query(`
    SELECT id, latitude, longitude, created_at, last_location_reviewed_at,
           location_review_status, next_location_review_due_at
    FROM farmers
  `);

  let updatedCount = 0;
  transaction(() => {
    for (const farmer of farmers) {
      const { status, nextDue } = reviewStatusFor(farmer, today);
      if (farmer.location_review_status !== status || farmer.next_location_review_due_at !== nextDue) {
        run('UPDATE farmers SET location_review_status = ?, next_location_review_due_at = ? WHERE id = ?', [status, nextDue, farmer.id]);
        updatedCount++;
      }
    }
  });
  statusesRefreshedOn = today;

  if (updatedCount > 0) {
    console.log(`[Scheduler] Location review check updated ${updatedCount} farmer records.`);
  }
  return updatedCount;
}

function logAudit(actorId, actorName, action, entityType, entityId, details, beforeState = null, afterState = null, ip = null) {
  try {
    run(`
      INSERT INTO audit_logs (timestamp, actor_id, actor_name, action, entity_type, entity_id, details, before_state, after_state, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      new Date().toISOString(),
      String(actorId || 'SYSTEM'),
      String(actorName || 'System'),
      String(action),
      String(entityType),
      entityId ? String(entityId) : null,
      String(details),
      beforeState ? JSON.stringify(beforeState) : null,
      afterState ? JSON.stringify(afterState) : null,
      ip || null
    ]);
  } catch (err) {
    console.error('Failed to log audit event:', err);
  }
}

function isOpen() {
  return !!db;
}

module.exports = {
  DB_FILE,
  REVIEW_CYCLE_DAYS,
  initDatabase,
  closeDatabase,
  isOpen,
  exec,
  run,
  query,
  queryOne,
  transaction,
  logAudit,
  reviewStatusFor,
  refreshLocationReviewStatuses,
  seedBuyersAndDistributions
};
