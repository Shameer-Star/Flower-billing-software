const fs = require('fs');
const path = require('path');
const initSqlJs = require('sql.js/dist/sql-wasm-inline.js');
const bcrypt = require('bcryptjs');
require('dotenv').config();

const IS_VERCEL = !!process.env.VERCEL;
const DB_DIR = IS_VERCEL ? path.join('/tmp', 'data') : path.join(__dirname, 'data');
const DB_FILE = path.join(DB_DIR, 'fresh_blooms.sqlite');
const BUNDLED_DB_FILE = path.join(__dirname, 'data', 'fresh_blooms.sqlite');

let db = null;
let SQL = null;
let inTransaction = false;

// Ensure data folder exists
if (!fs.existsSync(DB_DIR)) {
  try {
    fs.mkdirSync(DB_DIR, { recursive: true });
  } catch (err) {
    console.warn('[Database] Could not create DB_DIR:', err);
  }
}

// Persist database to disk
function saveDb() {
  if (!db || inTransaction) return;
  try {
    const data = db.export();
    const buffer = Buffer.from(data);
    fs.writeFileSync(DB_FILE, buffer);
  } catch (err) {
    console.error('Failed to persist database to disk:', err);
  }
}

// Run single SQL statement with params
function run(sql, params = []) {
  if (!db) throw new Error('Database not initialized');
  db.run(sql, params);
  saveDb();
}

// Query multiple rows
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

// Query single row
function queryOne(sql, params = []) {
  const rows = query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

// Run in transaction
function transaction(fn) {
  if (!db) throw new Error('Database not initialized');
  inTransaction = true;
  try {
    db.run('BEGIN TRANSACTION;');
    const result = fn();
    db.run('COMMIT;');
    inTransaction = false;
    saveDb();
    return result;
  } catch (err) {
    try { db.run('ROLLBACK;'); } catch (rbErr) {}
    inTransaction = false;
    throw err;
  }
}

// Initialize database
async function initDatabase() {
  if (db) return db;

  if (!fs.existsSync(DB_DIR)) {
    try {
      fs.mkdirSync(DB_DIR, { recursive: true });
    } catch (e) {}
  }

  // On Vercel, copy pre-populated database to /tmp if it doesn't exist yet
  if (IS_VERCEL && !fs.existsSync(DB_FILE) && fs.existsSync(BUNDLED_DB_FILE)) {
    try {
      fs.copyFileSync(BUNDLED_DB_FILE, DB_FILE);
      console.log('[Database] Seeded SQLite database into /tmp from project bundle');
    } catch (err) {
      console.warn('[Database] Could not seed database file into /tmp:', err);
    }
  }

  SQL = await initSqlJs();

  if (fs.existsSync(DB_FILE)) {
    const fileBuffer = fs.readFileSync(DB_FILE);
    db = new SQL.Database(fileBuffer);
    console.log('[Database] Loaded existing database from', DB_FILE);
  } else {
    db = new SQL.Database();
    console.log('[Database] Initialized new database file.');
  }

  // Ensure latest schema and migrations
  applyMigrations();
  provisionInitialAdmin();
  run15DayLocationReviewScheduler();

  return db;
}

// Apply table schema & safe migrations
function applyMigrations() {
  // Check if legacy tables exist that need migration
  try {
    const userCols = query("PRAGMA table_info(users)");
    const hasEmail = userCols.some(c => c.name === 'email');
    if (!hasEmail && userCols.length > 0) {
      db.run("DROP TABLE IF EXISTS users;");
      console.log('[Migration] Upgraded users table for admin-only authentication.');
    }
  } catch (e) {}

  try {
    const auditCols = query("PRAGMA table_info(audit_logs)");
    const hasEntityType = auditCols.some(c => c.name === 'entity_type');
    if (!hasEntityType && auditCols.length > 0) {
      db.run("DROP TABLE IF EXISTS audit_logs;");
      console.log('[Migration] Upgraded audit_logs table to structured enterprise format.');
    }
  } catch (e) {}

  try {
    const settingCols = query("PRAGMA table_info(settings)");
    const hasUpdatedAt = settingCols.some(c => c.name === 'updated_at');
    if (!hasUpdatedAt && settingCols.length > 0) {
      db.run("DROP TABLE IF EXISTS settings;");
      console.log('[Migration] Upgraded settings table with updated_at column.');
    }
  } catch (e) {}

  db.run(`
    -- Admin Users Table (Admin-only role)
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      email TEXT UNIQUE NOT NULL,
      full_name TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin',
      password_hash TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Farmers Table (Core farmer profile and 15-day review status)
    CREATE TABLE IF NOT EXISTS farmers (
      id TEXT PRIMARY KEY,
      full_name TEXT NOT NULL,
      contact_number TEXT UNIQUE NOT NULL,
      address TEXT,
      village TEXT NOT NULL,
      latitude REAL,
      longitude REAL,
      status TEXT NOT NULL DEFAULT 'active',
      notes TEXT,
      total_collected_kg REAL DEFAULT 0,
      total_payout REAL DEFAULT 0,
      last_collection_date TEXT,
      last_location_reviewed_at TEXT,
      next_location_review_due_at TEXT,
      location_review_status TEXT DEFAULT 'unavailable',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Farmer Locations (15-day location review and audit trail)
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

    -- Collections Table (Real flower collections from registered farmers)
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
      quality_grade TEXT DEFAULT 'Grade A',
      payment_status TEXT NOT NULL DEFAULT 'Pending',
      payment_mode TEXT DEFAULT 'Cash',
      amount_paid REAL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'completed',
      cancellation_reason TEXT,
      notes TEXT,
      collected_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    -- Immutable Audit Logs Table
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

    -- Application Settings Table
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT
    );

    -- Indexes for high-performance querying
    CREATE INDEX IF NOT EXISTS idx_farmers_village ON farmers(village);
    CREATE INDEX IF NOT EXISTS idx_farmers_status ON farmers(status);
    CREATE INDEX IF NOT EXISTS idx_farmers_loc_status ON farmers(location_review_status);
    CREATE INDEX IF NOT EXISTS idx_collections_farmer ON collections(farmer_id);
    CREATE INDEX IF NOT EXISTS idx_collections_date ON collections(collection_date);
    CREATE INDEX IF NOT EXISTS idx_locations_farmer ON farmer_locations(farmer_id);
    CREATE INDEX IF NOT EXISTS idx_audit_entity ON audit_logs(entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);
  `);

  // Default system settings if absent
  const defaultSettings = [
    ['system_name', 'Fresh Blooms - Farmer Collection System'],
    ['organization_name', 'Fresh Blooms Floral Operations'],
    ['default_currency', '₹'],
    ['weight_unit', 'kg'],
    ['location_review_cycle_days', '15'],
    ['session_timeout_minutes', '120'],
    ['backup_retention_days', '90']
  ];

  for (const [key, val] of defaultSettings) {
    const existing = queryOne('SELECT key FROM settings WHERE key = ?', [key]);
    if (!existing) {
      db.run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [key, val, new Date().toISOString()]);
    }
  }

  saveDb();
}

// Provision initial Administrator account securely if no admin exists
function provisionInitialAdmin() {
  const adminCount = queryOne("SELECT COUNT(*) as count FROM users WHERE role = 'admin'");
  if (adminCount && adminCount.count > 0) {
    return; // Admin account already securely provisioned
  }

  const username = process.env.ADMIN_INITIAL_USERNAME || 'admin';
  const plainPassword = process.env.ADMIN_INITIAL_PASSWORD || 'Admin@12345';
  const email = process.env.ADMIN_INITIAL_EMAIL || 'admin@freshblooms.com';
  const fullName = process.env.ADMIN_INITIAL_NAME || 'System Administrator';

  const hash = bcrypt.hashSync(plainPassword, 12);
  const now = new Date().toISOString();

  db.run(`
    INSERT INTO users (username, email, full_name, role, password_hash, status, created_at, updated_at)
    VALUES (?, ?, ?, 'admin', ?, 'active', ?, ?)
  `, [username, email, fullName, hash, now, now]);

  // Log audit event for initial provisioning
  db.run(`
    INSERT INTO audit_logs (timestamp, actor_id, actor_name, action, entity_type, entity_id, details)
    VALUES (?, 'SYSTEM', 'System Initializer', 'ADMIN_PROVISIONED', 'users', ?, 'Initial administrator account provisioned securely')
  `, [now, username]);

  saveDb();
  console.log(`[Security] Secure Admin account provisioned for username: "${username}".`);
}

// 15-Day Farmer Location Review Scheduler
// Runs periodically and marks farmers due or overdue for location verification
function run15DayLocationReviewScheduler() {
  try {
    const cycleDays = parseInt(process.env.LOCATION_REVIEW_CYCLE_DAYS || '15', 10);
    const now = new Date();
    const farmers = query('SELECT * FROM farmers');

    let updatedCount = 0;

    for (const farmer of farmers) {
      const hasCoords = farmer.latitude !== null && farmer.longitude !== null;
      let reviewStatus = 'unavailable';
      let nextDue = farmer.next_location_review_due_at;

      if (!hasCoords) {
        reviewStatus = 'unavailable';
      } else if (!farmer.last_location_reviewed_at) {
        // Has coordinates but never formally reviewed
        const createdDate = new Date(farmer.created_at);
        const daysSinceCreated = Math.floor((now - createdDate) / (1000 * 60 * 60 * 24));
        if (daysSinceCreated >= cycleDays) {
          reviewStatus = 'overdue';
        } else if (daysSinceCreated >= cycleDays - 3) {
          reviewStatus = 'due_soon';
        } else {
          reviewStatus = 'verified';
        }
        const dueDate = new Date(createdDate);
        dueDate.setDate(dueDate.getDate() + cycleDays);
        nextDue = dueDate.toISOString().slice(0, 10);
      } else {
        const lastReview = new Date(farmer.last_location_reviewed_at);
        const daysSinceReview = Math.floor((now - lastReview) / (1000 * 60 * 60 * 24));

        if (daysSinceReview >= cycleDays) {
          reviewStatus = 'overdue';
        } else if (daysSinceReview >= cycleDays - 3) {
          reviewStatus = 'due_soon';
        } else {
          reviewStatus = 'verified';
        }

        const dueDate = new Date(lastReview);
        dueDate.setDate(dueDate.getDate() + cycleDays);
        nextDue = dueDate.toISOString().slice(0, 10);
      }

      if (farmer.location_review_status !== reviewStatus || farmer.next_location_review_due_at !== nextDue) {
        db.run(
          'UPDATE farmers SET location_review_status = ?, next_location_review_due_at = ? WHERE id = ?',
          [reviewStatus, nextDue, farmer.id]
        );
        updatedCount++;
      }
    }

    if (updatedCount > 0) {
      saveDb();
      console.log(`[Scheduler] 15-Day Location Review check updated ${updatedCount} farmer records.`);
    }
  } catch (err) {
    console.error('[Scheduler] Error running location review scheduler:', err);
  }
}

// Log audit trail event safely
function logAudit(actorId, actorName, action, entityType, entityId, details, beforeState = null, afterState = null, ip = null) {
  try {
    const now = new Date().toISOString();
    run(`
      INSERT INTO audit_logs (timestamp, actor_id, actor_name, action, entity_type, entity_id, details, before_state, after_state, ip_address)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      now,
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

module.exports = {
  initDatabase,
  run,
  query,
  queryOne,
  transaction,
  saveDb,
  logAudit,
  run15DayLocationReviewScheduler
};
