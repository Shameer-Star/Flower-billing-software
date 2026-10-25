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
  `);

  // Column additions for existing tables
  addColumnIfMissing('farmers', 'name_ta', 'TEXT');
  addColumnIfMissing('farmers', 'village_ta', 'TEXT');
  addColumnIfMissing('farmers', 'district', "TEXT DEFAULT 'Kanyakumari'");
  addColumnIfMissing('farmers', 'state', "TEXT DEFAULT 'Tamil Nadu'");
  addColumnIfMissing('farmers', 'location_source', "TEXT DEFAULT 'manual'");
  addColumnIfMissing('farmers', 'is_synthetic', 'INTEGER NOT NULL DEFAULT 0');
  addColumnIfMissing('farmers', 'version', 'INTEGER NOT NULL DEFAULT 1');

  addColumnIfMissing('collections', 'client_ref', 'TEXT');
  addColumnIfMissing('collections', 'applicable_charges', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('collections', 'net_amount', 'REAL NOT NULL DEFAULT 0');
  addColumnIfMissing('collections', 'version', 'INTEGER NOT NULL DEFAULT 1');

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
  refreshLocationReviewStatuses
};
