const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const {
  DB_FILE,
  REVIEW_CYCLE_DAYS,
  initDatabase,
  closeDatabase,
  exec,
  run,
  query,
  queryOne,
  transaction,
  logAudit,
  reviewStatusFor,
  refreshLocationReviewStatuses
} = require('./db');

const {
  APP_TZ,
  localDate,
  isDateStr,
  addDays,
  daysBetween,
  fortnightKey,
  isFortnightKey,
  fortnightRange,
  previousFortnightKey,
  lastFortnights
} = require('./dates');

const {
  AUDIT_INTERVAL_DAYS,
  setBroadcastCallback,
  runComprehensiveAudit,
  getLatestAudit,
  initAuditScheduler
} = require('./system-audit');

const {
  broadcastSyncEvent,
  handleSyncEvents,
  handleSyncPoll,
  getActiveClientCount
} = require('./sync');

// Link broadcast callback so system-audit can broadcast
setBroadcastCallback(broadcastSyncEvent);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secure_admin_jwt_secret_key_2026';
if (!process.env.JWT_SECRET) {
  console.warn('[Security] JWT_SECRET is not set: using the public default. Set it before real use.');
}

const MAX_FARMERS = parseInt(process.env.MAX_FARMERS, 10) || 2000;

// Vocabularies
const FLOWERS = ['Jasmine', 'Rose', 'Marigold', 'Chrysanthemum', 'Crossandra', 'Tuberose', 'Lotus', 'Lily', 'Nerium'];
const PAYMENT_STATUSES = ['Pending', 'Paid', 'Partial'];
const PAYMENT_MODES = ['Cash', 'UPI', 'Bank Transfer'];
const LOCATION_SOURCES = ['Admin Verified Update', 'Field Visit Collection', 'Farmer Submitted', 'GPS Device'];
const FARMER_STATUSES = ['active', 'inactive'];

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors());

// Custom JSON body parser with malformed JSON handler
app.use((req, res, next) => {
  express.json({ limit: '2mb' })(req, res, err => {
    if (err) {
      return fail(res, 400, 'malformed_json', 'Malformed JSON in request body.');
    }
    if (req.body === undefined || req.body === null || typeof req.body !== 'object') {
      req.body = {};
    }
    next();
  });
});

app.use(express.static(path.join(__dirname, 'public')));

// Ensure Database is initialized before handling any requests
let dbReadyPromise = null;
function ensureDbReady() {
  if (!dbReadyPromise) {
    dbReadyPromise = initDatabase().then(() => {
      initAuditScheduler();
    }).catch(err => {
      console.error('[Fatal Error] Database failed to initialize:', err);
      dbReadyPromise = null;
      throw err;
    });
  }
  return dbReadyPromise;
}

app.use(async (req, res, next) => {
  if (!req.path.startsWith('/api')) {
    return next();
  }
  try {
    await ensureDbReady();
    next();
  } catch (err) {
    fail(res, 500, 'db_unavailable', 'Database service unavailable.');
  }
});

// =========================================================
// HELPERS
// =========================================================

function fail(res, status, code, message) {
  return res.status(status).json({ error: message, code });
}

function str(value, max = 200) {
  if (typeof value === 'number' && isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

function num(value) {
  if (value === '' || value === null || value === undefined || typeof value === 'boolean') return NaN;
  return Number(value);
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

function cleanPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 13 && digits.startsWith('091')) {
    digits = digits.slice(3);
  }
  return digits.length === 10 ? digits : null;
}

function optionalCoords(latitude, longitude) {
  const blank = v => v === undefined || v === null || v === '' || (typeof v === 'string' && v.trim() === '');
  if (blank(latitude) && blank(longitude)) return { lat: null, lng: null, ok: true };
  const lat = num(latitude);
  const lng = num(longitude);
  const ok = !isNaN(lat) && !isNaN(lng) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
  return { lat, lng, ok };
}

function nextId(table, prefix) {
  const name = `${table}:${prefix}`;
  const row = queryOne('UPDATE sequences SET value = value + 1 WHERE name = ? RETURNING value', [name]);
  if (row && !queryOne(`SELECT 1 AS taken FROM ${table} WHERE id = ?`, [`${prefix}${row.value}`])) {
    return `${prefix}${row.value}`;
  }
  const max = queryOne(
    `SELECT MAX(CAST(SUBSTR(id, ?) AS INTEGER)) AS n FROM ${table} WHERE id LIKE ?`,
    [prefix.length + 1, `${prefix}%`]
  );
  const value = Math.max(1000, (max && max.n) || 0) + 1;
  run('INSERT INTO sequences (name, value) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value', [name, value]);
  return `${prefix}${value}`;
}

function recomputeFarmerTotals(farmerId) {
  const totals = queryOne(`
    SELECT COALESCE(SUM(quantity_kg), 0) AS kg,
           COALESCE(SUM(total_amount), 0) AS amount,
           MAX(collection_date) AS last_date
    FROM collections
    WHERE farmer_id = ? AND status = 'completed'
  `, [farmerId]);
  run(
    'UPDATE farmers SET total_collected_kg = ?, total_payout = ?, updated_at = ? WHERE id = ?',
    [round2(totals ? totals.kg : 0), round2(totals ? totals.amount : 0), new Date().toISOString(), farmerId]
  );
}

function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

function sendCsv(res, filename, header, rows) {
  const lines = [header, ...rows].map(r => r.map(csvCell).join(','));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  // UTF-8 BOM
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const content = Buffer.from(lines.join('\r\n') + '\r\n', 'utf8');
  res.send(Buffer.concat([bom, content]));
}

function pageParams(req, defaultLimit = 50, maxLimit = 200) {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const limit = Math.max(1, Math.min(maxLimit, parseInt(req.query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}

// In-Memory Login Rate Limiter
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10);
const MAX_ATTEMPTS = parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS || '5', 10);

function rateLimitCheck(key) {
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record) return { allowed: true };

  if (now - record.firstAttempt > RATE_LIMIT_WINDOW) {
    loginAttempts.delete(key);
    return { allowed: true };
  }

  if (record.count >= MAX_ATTEMPTS) {
    const remainingSecs = Math.ceil((RATE_LIMIT_WINDOW - (now - record.firstAttempt)) / 1000);
    return { allowed: false, remainingSecs };
  }

  return { allowed: true };
}

function recordFailedAttempt(key) {
  const now = Date.now();
  const record = loginAttempts.get(key) || { count: 0, firstAttempt: now };
  record.count += 1;
  loginAttempts.set(key, record);
}

// Authentication Middleware
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  let tokenStr = null;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    tokenStr = authHeader.substring(7);
  } else if (req.query.token) {
    tokenStr = req.query.token;
  }

  if (!tokenStr) {
    return fail(res, 401, 'unauthorized', 'Authentication token is required.');
  }

  try {
    const decoded = jwt.verify(tokenStr, JWT_SECRET);
    const user = queryOne('SELECT id, username, email, full_name, role, status FROM users WHERE id = ?', [decoded.id]);

    if (!user) {
      return fail(res, 401, 'unauthorized', 'User account not found.');
    }
    if (user.status !== 'active') {
      return fail(res, 403, 'account_disabled', 'This account has been disabled.');
    }

    req.user = user;
    next();
  } catch (err) {
    logAudit('SYSTEM', 'System', 'AUTH_TOKEN_REJECTED', 'users', null, `Invalid JWT token rejected: ${err.message}`, null, null, req.ip);
    return fail(res, 401, 'unauthorized', 'Session expired or invalid.');
  }
}

// =========================================================
// API ROUTES
// =========================================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    system: 'Fresh Blooms Flower Billing & Farmer Management',
    time: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    sync_clients: getActiveClientCount()
  });
});

// Authentication Routes
app.post('/api/auth/login', (req, res) => {
  const username = str(req.body.username);
  const password = typeof req.body.password === 'string' ? req.body.password : '';
  const ip = req.ip || req.connection.remoteAddress;

  if (!username || !password) {
    return fail(res, 400, 'missing_credentials', 'Username and password are required.');
  }

  const rateKey = `login_${ip}_${username.toLowerCase()}`;
  const rateStatus = rateLimitCheck(rateKey);
  if (!rateStatus.allowed) {
    logAudit('SYSTEM', 'System', 'LOGIN_RATE_LIMITED', 'users', username, `Rate limited on IP ${ip}`, null, null, ip);
    return fail(res, 429, 'rate_limited', `Too many failed attempts. Try again in ${rateStatus.remainingSecs} seconds.`);
  }

  const user = queryOne('SELECT * FROM users WHERE (LOWER(username) = LOWER(?) OR LOWER(email) = LOWER(?))', [username, username]);

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFailedAttempt(rateKey);
    logAudit('SYSTEM', 'System', 'LOGIN_FAILED', 'users', username, `Invalid credentials from IP ${ip}`, null, null, ip);
    return fail(res, 401, 'invalid_credentials', 'Invalid username or password.');
  }

  if (user.status !== 'active') {
    return fail(res, 403, 'account_disabled', 'This account has been disabled.');
  }

  loginAttempts.delete(rateKey);

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role, name: user.full_name },
    JWT_SECRET,
    { expiresIn: '30d' }
  );

  logAudit(user.id, user.full_name, 'LOGIN_SUCCESS', 'users', user.id, `User logged in from ${ip}`, null, null, ip);

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      role: user.role
    }
  });
});

app.get('/api/auth/me', authenticateAdmin, (req, res) => {
  res.json({ user: req.user });
});

app.post('/api/auth/change-password', authenticateAdmin, (req, res) => {
  const currentPassword = typeof req.body.current_password === 'string' ? req.body.current_password : '';
  const newPassword = typeof req.body.new_password === 'string' ? req.body.new_password : '';

  if (!currentPassword || !newPassword) {
    return fail(res, 400, 'password_required', 'Current and new password are required.');
  }
  if (newPassword.length < 8) {
    return fail(res, 400, 'weak_password', 'New password must be at least 8 characters long.');
  }

  const user = queryOne('SELECT password_hash FROM users WHERE id = ?', [req.user.id]);
  if (!bcrypt.compareSync(currentPassword, user.password_hash)) {
    return fail(res, 400, 'wrong_current_password', 'Current password does not match.');
  }

  const newHash = bcrypt.hashSync(newPassword, 12);
  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [newHash, new Date().toISOString(), req.user.id]);

  logAudit(req.user.id, req.user.full_name, 'PASSWORD_CHANGED', 'users', req.user.id, 'User password changed successfully');
  res.json({ success: true, message: 'Password updated successfully.' });
});

app.post('/api/auth/logout', authenticateAdmin, (req, res) => {
  logAudit(req.user.id, req.user.full_name, 'LOGOUT', 'users', req.user.id, 'User logged out');
  res.json({ success: true });
});

// =========================================================
// FARMERS MODULE
// =========================================================

// List farmers (search, filter, sort, pagination)
app.get('/api/farmers', authenticateAdmin, (req, res) => {
  refreshLocationReviewStatuses();
  const search = str(req.query.search, 100);
  const status = str(req.query.status);
  const locStatus = str(req.query.location_status) || str(req.query.reviewStatus);
  const village = str(req.query.village);
  const district = str(req.query.district);
  const sortBy = str(req.query.sort_by) || 'created_at';
  const sortDir = str(req.query.sort_dir).toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  const { page, limit, offset } = pageParams(req, 50, 200);

  const where = [];
  const params = [];

  if (search) {
    where.push('(id LIKE ? OR full_name LIKE ? OR name_ta LIKE ? OR contact_number LIKE ? OR village LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term, term);
  }
  if (status && FARMER_STATUSES.includes(status)) {
    where.push('status = ?');
    params.push(status);
  }
  if (locStatus) {
    where.push('location_review_status = ?');
    params.push(locStatus);
  }
  if (village) {
    where.push('village = ?');
    params.push(village);
  }
  if (district) {
    where.push('district = ?');
    params.push(district);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const allowedSorts = ['id', 'full_name', 'created_at', 'total_collected_kg', 'total_payout', 'next_location_review_due_at'];
  const safeSort = allowedSorts.includes(sortBy) ? sortBy : 'created_at';

  const totalRow = queryOne(`SELECT COUNT(*) as count FROM farmers ${whereSql}`, params);
  const total = totalRow ? totalRow.count : 0;

  const farmers = query(`
    SELECT id, full_name, name_ta, contact_number, village, village_ta, address, district, state,
           latitude, longitude, location_source, location_review_status, last_location_reviewed_at,
           next_location_review_due_at, status, total_collected_kg, total_payout, version, created_at, updated_at
    FROM farmers
    ${whereSql}
    ORDER BY ${safeSort} ${sortDir}
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  let villages = [];
  try {
    const villageRows = query("SELECT DISTINCT village FROM farmers WHERE village IS NOT NULL AND village != '' ORDER BY village ASC");
    villages = villageRows.map(r => r.village);
  } catch (e) {
    console.warn('[Farmers] Failed to fetch villages list:', e.message);
  }

  res.json({
    farmers,
    villages,
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
  });
});

// Fast combobox options for active farmers (No row cap, matches test)
app.get('/api/farmers/options', authenticateAdmin, (req, res) => {
  const farmers = query(`
    SELECT id, full_name, name_ta, village, contact_number
    FROM farmers
    WHERE status = 'active'
    ORDER BY full_name COLLATE NOCASE ASC
  `);
  res.json({ farmers });
});

// Register new farmer
app.post('/api/farmers', authenticateAdmin, (req, res) => {
  const fullName = str(req.body.full_name);
  const nameTa = str(req.body.name_ta);
  const rawContact = req.body.contact_number;
  const village = str(req.body.village);
  const villageTa = str(req.body.village_ta);
  const address = str(req.body.address);
  const district = str(req.body.district) || 'Kanyakumari';
  const state = str(req.body.state) || 'Tamil Nadu';
  const notes = str(req.body.notes, 500);
  const billingCycle = req.body.billing_cycle_days !== undefined && [15, 20, 30].includes(parseInt(req.body.billing_cycle_days, 10))
    ? parseInt(req.body.billing_cycle_days, 10)
    : 15;
  const commissionRate = req.body.commission_rate !== undefined && !isNaN(Number(req.body.commission_rate))
    ? Math.max(0, Math.min(100, Number(req.body.commission_rate)))
    : 10.0;

  if (!fullName) {
    return fail(res, 400, 'name_required', 'Farmer name is required.');
  }

  const contact = cleanPhone(rawContact);
  if (!contact) {
    return fail(res, 400, 'invalid_contact', 'A valid 10-digit mobile number is required.');
  }

  if (!village) {
    return fail(res, 400, 'village_required', 'Village name is required.');
  }

  const coords = optionalCoords(req.body.latitude, req.body.longitude);
  if (!coords.ok) {
    return fail(res, 400, 'invalid_location', 'Invalid latitude or longitude coordinates.');
  }

  // Refuse if at capacity
  const activeCount = queryOne("SELECT COUNT(*) AS n FROM farmers WHERE status = 'active'");
  if (activeCount && activeCount.n >= MAX_FARMERS) {
    return fail(res, 409, 'farmer_limit', `Maximum farmer capacity (${MAX_FARMERS}) reached.`);
  }

  // Check duplicate phone
  const existing = queryOne('SELECT id, full_name FROM farmers WHERE contact_number = ?', [contact]);
  if (existing) {
    return fail(res, 409, 'duplicate_phone', `Phone number is already registered to farmer ${existing.full_name} (${existing.id}).`);
  }

  const now = new Date().toISOString();
  const today = localDate();
  const locSource = coords.lat !== null ? (req.body.location_source || 'manual') : 'unavailable';

  let farmerRecord = null;
  transaction(() => {
    const farmerId = nextId('farmers', 'FAR-');
    const { status: locStatus, nextDue } = reviewStatusFor(
      { latitude: coords.lat, longitude: coords.lng, last_location_reviewed_at: coords.lat !== null ? today : null, created_at: now },
      today
    );

    run(`
      INSERT INTO farmers (
        id, full_name, name_ta, contact_number, village, village_ta, address, district, state,
        latitude, longitude, location_source, location_review_status, last_location_reviewed_at,
        next_location_review_due_at, billing_cycle_days, commission_rate, status, total_collected_kg, total_payout, notes, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 0, ?, 1, ?, ?)
    `, [
      farmerId, fullName, nameTa || null, contact, village, villageTa || null, address || null,
      district, state, coords.lat, coords.lng, locSource, locStatus,
      coords.lat !== null ? today : null, nextDue, billingCycle, commissionRate, notes || null, now, now
    ]);

    if (coords.lat !== null) {
      run(`
        INSERT INTO farmer_locations (
          farmer_id, latitude, longitude, village, address, source, verification_status,
          verified_by, capture_timestamp, review_notes, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?)
      `, [
        farmerId, coords.lat, coords.lng, village, address || null, locSource,
        req.user.full_name, now, 'Initial registration coordinates', now
      ]);
    }

    farmerRecord = queryOne('SELECT * FROM farmers WHERE id = ?', [farmerId]);

    logAudit(req.user.id, req.user.full_name, 'FARMER_REGISTERED', 'farmers', farmerId,
      `Farmer ${fullName} registered with contact ${contact} (Cycle: ${billingCycle}d, Comm: ${commissionRate}%)`, null, farmerRecord);
  });

  broadcastSyncEvent('FARMER_CREATED', 'farmers', farmerRecord.id, farmerRecord, req.body.client_id);
  res.status(201).json(farmerRecord);
});

// Single farmer profile
app.get('/api/farmers/:id', authenticateAdmin, (req, res) => {
  const farmer = queryOne('SELECT * FROM farmers WHERE id = ?', [req.params.id]);
  if (!farmer) {
    return fail(res, 404, 'farmer_not_found', 'Farmer not found.');
  }

  const collections = query(`
    SELECT * FROM collections
    WHERE farmer_id = ?
    ORDER BY collection_date DESC, created_at DESC
    LIMIT 20
  `, [farmer.id]);

  const locations = query(`
    SELECT * FROM farmer_locations
    WHERE farmer_id = ?
    ORDER BY capture_timestamp DESC
    LIMIT 10
  `, [farmer.id]);

  res.json({
    ...farmer,
    collections,
    locations
  });
});

// Edit farmer details
app.put('/api/farmers/:id', authenticateAdmin, (req, res) => {
  const farmer = queryOne('SELECT * FROM farmers WHERE id = ?', [req.params.id]);
  if (!farmer) {
    return fail(res, 404, 'farmer_not_found', 'Farmer not found.');
  }

  const fullName = str(req.body.full_name) || farmer.full_name;
  const nameTa = req.body.name_ta !== undefined ? str(req.body.name_ta) : farmer.name_ta;
  const rawContact = req.body.contact_number !== undefined ? req.body.contact_number : farmer.contact_number;
  const contact = cleanPhone(rawContact);
  const village = str(req.body.village) || farmer.village;
  const villageTa = req.body.village_ta !== undefined ? str(req.body.village_ta) : farmer.village_ta;
  const address = req.body.address !== undefined ? str(req.body.address) : farmer.address;
  const district = str(req.body.district) || farmer.district;
  const state = str(req.body.state) || farmer.state;
  const status = str(req.body.status) || farmer.status;
  const notes = req.body.notes !== undefined ? str(req.body.notes, 500) : farmer.notes;
  const billingCycle = req.body.billing_cycle_days !== undefined && [15, 20, 30].includes(parseInt(req.body.billing_cycle_days, 10))
    ? parseInt(req.body.billing_cycle_days, 10)
    : (farmer.billing_cycle_days || 15);
  const commissionRate = req.body.commission_rate !== undefined && !isNaN(Number(req.body.commission_rate))
    ? Math.max(0, Math.min(100, Number(req.body.commission_rate)))
    : (farmer.commission_rate !== undefined && farmer.commission_rate !== null ? Number(farmer.commission_rate) : 10.0);

  if (!contact) {
    return fail(res, 400, 'invalid_contact', 'A valid 10-digit mobile number is required.');
  }

  // Check phone uniqueness
  const dup = queryOne('SELECT id FROM farmers WHERE contact_number = ? AND id != ?', [contact, farmer.id]);
  if (dup) {
    return fail(res, 409, 'duplicate_phone', 'Phone number is already used by another farmer.');
  }

  const now = new Date().toISOString();
  transaction(() => {
    run(`
      UPDATE farmers
      SET full_name = ?, name_ta = ?, contact_number = ?, village = ?, village_ta = ?,
          address = ?, district = ?, state = ?, billing_cycle_days = ?, commission_rate = ?,
          status = ?, notes = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `, [fullName, nameTa || null, contact, village, villageTa || null, address || null,
        district, state, billingCycle, commissionRate, status, notes || null, now, farmer.id]);

    logAudit(req.user.id, req.user.full_name, 'FARMER_UPDATED', 'farmers', farmer.id,
      `Farmer ${fullName} (${farmer.id}) updated: Cycle ${billingCycle}d, Comm ${commissionRate}%`, farmer, req.body);
  });

  const updated = queryOne('SELECT * FROM farmers WHERE id = ?', [farmer.id]);
  broadcastSyncEvent('FARMER_UPDATED', 'farmers', updated.id, updated, req.body.client_id);
  res.json(updated);
});

// Update farmer location (15-day review check)
app.post('/api/farmers/:id/location', authenticateAdmin, (req, res) => {
  const farmer = queryOne('SELECT * FROM farmers WHERE id = ?', [req.params.id]);
  if (!farmer) {
    return fail(res, 404, 'farmer_not_found', 'Farmer not found.');
  }

  const coords = optionalCoords(req.body.latitude, req.body.longitude);
  if (!coords.ok || coords.lat === null) {
    return fail(res, 400, 'invalid_location', 'Valid latitude and longitude coordinates are required.');
  }

  const village = str(req.body.village) || farmer.village;
  const address = str(req.body.address) || farmer.address;
  const source = str(req.body.source) || 'Admin Verified Update';
  const notes = str(req.body.notes, 500);

  const now = new Date().toISOString();
  const today = localDate();
  const nextDue = addDays(today, REVIEW_CYCLE_DAYS);

  transaction(() => {
    run(`
      INSERT INTO farmer_locations (
        farmer_id, latitude, longitude, village, address, source, verification_status,
        verified_by, capture_timestamp, review_notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?)
    `, [farmer.id, coords.lat, coords.lng, village, address, source, req.user.full_name, now, notes, now]);

    run(`
      UPDATE farmers
      SET latitude = ?, longitude = ?, village = ?, address = ?, location_source = ?,
          location_review_status = 'verified', last_location_reviewed_at = ?,
          next_location_review_due_at = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `, [coords.lat, coords.lng, village, address, source, today, nextDue, now, farmer.id]);

    logAudit(req.user.id, req.user.full_name, 'FARMER_LOCATION_VERIFIED', 'farmers', farmer.id,
      `Location verified for ${farmer.full_name}: (${coords.lat}, ${coords.lng})`);
  });

  const updated = queryOne('SELECT * FROM farmers WHERE id = ?', [farmer.id]);
  broadcastSyncEvent('FARMER_LOCATION_UPDATED', 'farmers', updated.id, updated, req.body.client_id);
  res.json(updated);
});

// Map coordinates for all farmers
app.get('/api/farmers/locations/map', authenticateAdmin, (req, res) => {
  refreshLocationReviewStatuses();
  const reviewStatus = str(req.query.reviewStatus);
  const village = str(req.query.village);
  const where = ["latitude IS NOT NULL", "longitude IS NOT NULL", "status = 'active'"];
  const params = [];
  if (reviewStatus) {
    where.push('location_review_status = ?');
    params.push(reviewStatus);
  }
  if (village) {
    where.push('village = ?');
    params.push(village);
  }
  const whereSql = `WHERE ${where.join(' AND ')}`;
  const farmers = query(`
    SELECT id, full_name, name_ta, contact_number, village, district,
           latitude, longitude, location_source, location_review_status,
           last_location_reviewed_at, next_location_review_due_at, total_collected_kg, address, notes
    FROM farmers
    ${whereSql}
    ORDER BY full_name COLLATE NOCASE ASC
  `, params);
  res.json({ farmers, count: farmers.length });
});

// =========================================================
// FLOWER BILLING & COLLECTIONS MODULE
// =========================================================

// Create new flower purchase / bill
app.post('/api/collections', authenticateAdmin, (req, res) => {
  const farmerId = str(req.body.farmer_id);
  if (!farmerId) {
    return fail(res, 400, 'farmer_required', 'Farmer selection is required.');
  }

  const farmer = queryOne('SELECT id, full_name, village, commission_rate, billing_cycle_days FROM farmers WHERE id = ?', [farmerId]);
  if (!farmer) {
    return fail(res, 404, 'farmer_not_found', 'Selected farmer not found.');
  }

  const flowerType = str(req.body.flower_type);
  if (!flowerType || !FLOWERS.includes(flowerType)) {
    return fail(res, 400, 'invalid_flower', `Flower type must be one of: ${FLOWERS.join(', ')}.`);
  }

  const rawQty = req.body.quantity_kg;
  const quantity = num(rawQty);
  if (isNaN(quantity) || quantity <= 0) {
    return fail(res, 400, 'invalid_weight', 'Quantity must be a positive number greater than 0.');
  }

  const rawRate = req.body.rate_per_kg;
  const rate = num(rawRate);
  if (isNaN(rate) || rate <= 0) {
    return fail(res, 400, 'invalid_price', 'Price per kg must be a positive number greater than 0.');
  }

  const today = localDate();
  const collectionDate = str(req.body.collection_date) || today;
  if (!isDateStr(collectionDate)) {
    return fail(res, 400, 'invalid_date', 'Collection date must be a valid YYYY-MM-DD string.');
  }
  if (collectionDate > today) {
    return fail(res, 400, 'date_in_future', 'Collection date cannot be in the future.');
  }

  const paymentStatus = str(req.body.payment_status) || 'Pending';
  if (!PAYMENT_STATUSES.includes(paymentStatus)) {
    return fail(res, 400, 'invalid_payment_status', 'Payment status must be Pending, Paid, or Partial.');
  }

  const clientRef = str(req.body.client_ref, 100);
  // Idempotency: return existing bill if retried with same client_ref
  if (clientRef) {
    const existing = queryOne('SELECT * FROM collections WHERE client_ref = ?', [clientRef]);
    if (existing) {
      return res.status(200).json(existing);
    }
  }

  const charges = Math.max(0, num(req.body.applicable_charges) || 0);
  const totalAmount = round2(quantity * rate);
  const commRate = req.body.commission_rate !== undefined && !isNaN(Number(req.body.commission_rate))
    ? Math.max(0, Math.min(100, Number(req.body.commission_rate)))
    : (farmer.commission_rate !== undefined && farmer.commission_rate !== null ? Number(farmer.commission_rate) : 10.0);
  const commAmount = round2(totalAmount * (commRate / 100));
  const netAmount = req.body.deduct_commission ? round2(totalAmount - commAmount + charges) : round2(totalAmount + charges);
  const amountPaid = paymentStatus === 'Paid' ? netAmount : Math.max(0, num(req.body.amount_paid) || 0);
  const paymentMode = str(req.body.payment_mode) || 'Cash';
  const qualityGrade = str(req.body.quality_grade) || 'Grade A';
  const variety = str(req.body.variety, 100);
  const notes = str(req.body.notes, 500);

  const now = new Date().toISOString();
  const year = collectionDate.slice(0, 4);

  let collectionRecord = null;
  transaction(() => {
    const billId = nextId('collections', `COL-${year}-`);

    run(`
      INSERT INTO collections (
        id, farmer_id, farmer_name, farmer_village, collection_date, flower_type, variety,
        quantity_kg, rate_per_kg, total_amount, gross_amount, commission_rate, commission_amount, applicable_charges, net_amount,
        quality_grade, payment_status, payment_mode, amount_paid, status,
        notes, collected_by, client_ref, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, 1, ?, ?)
    `, [
      billId, farmer.id, farmer.full_name, farmer.village, collectionDate, flowerType, variety || null,
      round2(quantity), round2(rate), totalAmount, totalAmount, commRate, commAmount, charges, netAmount,
      qualityGrade, paymentStatus, paymentMode, amountPaid,
      notes || null, req.user.full_name, clientRef || null, now, now
    ]);

    recomputeFarmerTotals(farmer.id);
    collectionRecord = queryOne('SELECT * FROM collections WHERE id = ?', [billId]);

    logAudit(req.user.id, req.user.full_name, 'COLLECTION_RECORDED', 'collections', billId,
      `Recorded purchase ${billId} for ${farmer.full_name}: ${quantity}kg ${flowerType} @ ₹${rate} = ₹${totalAmount} (Comm ${commRate}%: ₹${commAmount})`,
      null, collectionRecord);
  });

  broadcastSyncEvent('COLLECTION_CREATED', 'collections', collectionRecord.id, collectionRecord, req.body.client_id);
  res.status(201).json(collectionRecord);
});

// List flower bills (with date filter, pagination, day totals)
app.get('/api/collections', authenticateAdmin, (req, res) => {
  const date = str(req.query.date);
  const search = str(req.query.search);
  const farmerId = str(req.query.farmer_id);
  const flower = str(req.query.flower_type);
  const paymentStatus = str(req.query.payment_status);
  const { page, limit, offset } = pageParams(req, 50, 200);

  const where = [];
  const params = [];

  if (date) {
    where.push('collection_date = ?');
    params.push(date);
  }
  if (farmerId) {
    where.push('farmer_id = ?');
    params.push(farmerId);
  }
  if (flower) {
    where.push('flower_type = ?');
    params.push(flower);
  }
  if (paymentStatus) {
    where.push('payment_status = ?');
    params.push(paymentStatus);
  }
  if (search) {
    where.push('(id LIKE ? OR farmer_id LIKE ? OR farmer_name LIKE ? OR farmer_village LIKE ?)');
    const term = `%${search}%`;
    params.push(term, term, term, term);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = queryOne(`SELECT COUNT(*) as count FROM collections ${whereSql}`, params);
  const total = totalRow ? totalRow.count : 0;

  // Day totals (completed bills only)
  const totalsWhere = [...where, "status = 'completed'"];
  const totalsSql = totalsWhere.length > 0 ? `WHERE ${totalsWhere.join(' AND ')}` : '';
  const dayStats = queryOne(`
    SELECT
      COUNT(*) AS entries,
      COALESCE(SUM(quantity_kg), 0) AS kg,
      COALESCE(SUM(total_amount), 0) AS amount
    FROM collections
    ${totalsSql}
  `, params);

  const collections = query(`
    SELECT * FROM collections
    ${whereSql}
    ORDER BY collection_date DESC, created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  res.json({
    collections,
    totals: {
      entries: dayStats ? dayStats.entries : 0,
      kg: round2(dayStats ? dayStats.kg : 0),
      amount: round2(dayStats ? dayStats.amount : 0)
    },
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
  });
});

// Single collection
app.get('/api/collections/:id', authenticateAdmin, (req, res) => {
  const collection = queryOne('SELECT * FROM collections WHERE id = ?', [req.params.id]);
  if (!collection) {
    return fail(res, 404, 'bill_not_found', 'Purchase bill not found.');
  }
  res.json(collection);
});

// Edit existing bill
app.put('/api/collections/:id', authenticateAdmin, (req, res) => {
  const collection = queryOne('SELECT * FROM collections WHERE id = ?', [req.params.id]);
  if (!collection) {
    return fail(res, 404, 'bill_not_found', 'Purchase bill not found.');
  }
  if (collection.status === 'cancelled') {
    return fail(res, 400, 'already_cancelled', 'Cancelled bills cannot be edited.');
  }

  const rawQty = req.body.quantity_kg !== undefined ? req.body.quantity_kg : collection.quantity_kg;
  const quantity = num(rawQty);
  if (isNaN(quantity) || quantity <= 0) {
    return fail(res, 400, 'invalid_weight', 'Quantity must be greater than 0.');
  }

  const rawRate = req.body.rate_per_kg !== undefined ? req.body.rate_per_kg : collection.rate_per_kg;
  const rate = num(rawRate);
  if (isNaN(rate) || rate <= 0) {
    return fail(res, 400, 'invalid_price', 'Price per kg must be greater than 0.');
  }

  const flowerType = str(req.body.flower_type) || collection.flower_type;
  if (!FLOWERS.includes(flowerType)) {
    return fail(res, 400, 'invalid_flower', 'Invalid flower type.');
  }

  const charges = req.body.applicable_charges !== undefined ? Math.max(0, num(req.body.applicable_charges) || 0) : collection.applicable_charges;
  const totalAmount = round2(quantity * rate);
  const commRate = req.body.commission_rate !== undefined && !isNaN(Number(req.body.commission_rate))
    ? Math.max(0, Math.min(100, Number(req.body.commission_rate)))
    : (collection.commission_rate !== undefined && collection.commission_rate !== null ? Number(collection.commission_rate) : 10.0);
  const commAmount = round2(totalAmount * (commRate / 100));
  const netAmount = req.body.deduct_commission ? round2(totalAmount - commAmount + charges) : round2(totalAmount + charges);
  const paymentStatus = str(req.body.payment_status) || collection.payment_status;
  const paymentMode = str(req.body.payment_mode) || collection.payment_mode;
  const amountPaid = req.body.amount_paid !== undefined ? Math.max(0, num(req.body.amount_paid) || 0) : collection.amount_paid;
  const notes = req.body.notes !== undefined ? str(req.body.notes, 500) : collection.notes;

  const now = new Date().toISOString();
  transaction(() => {
    run(`
      UPDATE collections
      SET flower_type = ?, quantity_kg = ?, rate_per_kg = ?, total_amount = ?, gross_amount = ?,
          commission_rate = ?, commission_amount = ?, applicable_charges = ?, net_amount = ?,
          payment_status = ?, payment_mode = ?, amount_paid = ?, notes = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `, [flowerType, round2(quantity), round2(rate), totalAmount, totalAmount,
        commRate, commAmount, charges, netAmount,
        paymentStatus, paymentMode, amountPaid, notes, now, collection.id]);

    recomputeFarmerTotals(collection.farmer_id);

    logAudit(req.user.id, req.user.full_name, 'COLLECTION_UPDATED', 'collections', collection.id,
      `Updated bill ${collection.id}: ${quantity}kg @ ₹${rate} = ₹${totalAmount} (Comm ${commRate}%: ₹${commAmount})`, collection, req.body);
  });

  const updated = queryOne('SELECT * FROM collections WHERE id = ?', [collection.id]);
  broadcastSyncEvent('COLLECTION_UPDATED', 'collections', updated.id, updated, req.body.client_id);
  res.json(updated);
});

// Cancel bill
app.post('/api/collections/:id/cancel', authenticateAdmin, (req, res) => {
  const collection = queryOne('SELECT * FROM collections WHERE id = ?', [req.params.id]);
  if (!collection) {
    return fail(res, 404, 'bill_not_found', 'Purchase bill not found.');
  }
  if (collection.status === 'cancelled') {
    return fail(res, 400, 'already_cancelled', 'Bill is already cancelled.');
  }

  const reason = str(req.body.reason, 300);
  if (!reason) {
    return fail(res, 400, 'reason_required', 'Cancellation reason is required.');
  }

  const now = new Date().toISOString();
  transaction(() => {
    run(`
      UPDATE collections
      SET status = 'cancelled', cancellation_reason = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `, [reason, now, collection.id]);

    recomputeFarmerTotals(collection.farmer_id);

    logAudit(req.user.id, req.user.full_name, 'COLLECTION_CANCELLED', 'collections', collection.id,
      `Cancelled bill ${collection.id}. Reason: "${reason}"`, collection);
  });

  const updated = queryOne('SELECT * FROM collections WHERE id = ?', [collection.id]);
  broadcastSyncEvent('COLLECTION_CANCELLED', 'collections', updated.id, updated, req.body.client_id);
  res.json(updated);
});

// Update payment status for bill
app.post('/api/collections/:id/payment', authenticateAdmin, (req, res) => {
  const collection = queryOne('SELECT * FROM collections WHERE id = ?', [req.params.id]);
  if (!collection) {
    return fail(res, 404, 'bill_not_found', 'Purchase bill not found.');
  }
  if (collection.status === 'cancelled') {
    return fail(res, 400, 'already_cancelled', 'Cannot update payment on a cancelled bill.');
  }

  const paymentStatus = str(req.body.payment_status);
  if (!paymentStatus || !PAYMENT_STATUSES.includes(paymentStatus)) {
    return fail(res, 400, 'invalid_payment_status', 'Payment status must be Pending, Paid, or Partial.');
  }

  const paymentMode = str(req.body.payment_mode) || collection.payment_mode || 'Cash';
  const amountPaid = paymentStatus === 'Paid' ? collection.net_amount || collection.total_amount : Math.max(0, num(req.body.amount_paid) || 0);

  const now = new Date().toISOString();
  transaction(() => {
    run(`
      UPDATE collections
      SET payment_status = ?, payment_mode = ?, amount_paid = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `, [paymentStatus, paymentMode, amountPaid, now, collection.id]);

    logAudit(req.user.id, req.user.full_name, 'PAYMENT_STATUS_UPDATED', 'collections', collection.id,
      `Updated bill ${collection.id} payment status to ${paymentStatus}`);
  });

  const updated = queryOne('SELECT * FROM collections WHERE id = ?', [collection.id]);
  broadcastSyncEvent('PAYMENT_UPDATED', 'collections', updated.id, updated, req.body.client_id);
  res.json(updated);
});

// =========================================================
// 15-DAY AUDIT MODULES (FORTNIGHT & COMPREHENSIVE)
// =========================================================

// Fortnight Location Audit (6 fortnights, for backward compatibility & test suites)
app.get('/api/audit', authenticateAdmin, (req, res) => {
  refreshLocationReviewStatuses();
  const today = localDate();
  const fortnights = lastFortnights(today, 6);
  const currentKey = fortnightKey(today);
  const requestedKey = str(req.query.fortnight);
  const selectedKey = isFortnightKey(requestedKey) && fortnights.includes(requestedKey) ? requestedKey : currentKey;
  const isCurrentPeriod = selectedKey === currentKey;
  const range = fortnightRange(selectedKey);

  // Period totals
  const fortnightSummaries = fortnights.map(k => {
    const r = fortnightRange(k);
    const kgRow = queryOne(`
      SELECT COALESCE(SUM(quantity_kg), 0) AS total_kg
      FROM collections
      WHERE collection_date >= ? AND collection_date <= ? AND status = 'completed'
    `, [r.start, r.end]);

    const checkedRow = queryOne(`
      SELECT COUNT(DISTINCT farmer_id) AS checked_count
      FROM farmer_locations
      WHERE capture_timestamp >= ? AND capture_timestamp <= ?
    `, [`${r.start}T00:00:00.000Z`, `${r.end}T23:59:59.999Z`]);

    return {
      key: k,
      start: r.start,
      end: r.end,
      total_kg: round2(kgRow ? kgRow.total_kg : 0),
      farmers_checked: checkedRow ? checkedRow.checked_count : 0
    };
  });

  // If ?farmers=0, return summaries only
  if (req.query.farmers === '0') {
    return res.json({
      fortnights: fortnightSummaries,
      selected: selectedKey
    });
  }

  // Farmer verification details for the selected period
  const farmers = query(`
    SELECT
      f.id, f.full_name, f.name_ta, f.village, f.district, f.contact_number,
      f.latitude, f.longitude, f.location_review_status,
      loc.capture_timestamp as checked_timestamp,
      loc.latitude as checked_lat,
      loc.longitude as checked_lng
    FROM farmers f
    LEFT JOIN (
      SELECT farmer_id, capture_timestamp, latitude, longitude
      FROM farmer_locations
      WHERE capture_timestamp >= ? AND capture_timestamp <= ?
      GROUP BY farmer_id
    ) loc ON f.id = loc.farmer_id
    WHERE f.status = 'active'
    ORDER BY f.full_name COLLATE NOCASE ASC
  `, [`${range.start}T00:00:00.000Z`, `${range.end}T23:59:59.999Z`]);

  const farmerList = farmers.map(f => {
    const checked = !!f.checked_timestamp;
    return {
      id: f.id,
      full_name: f.full_name,
      name_ta: f.name_ta,
      village: f.village,
      district: f.district,
      contact_number: f.contact_number,
      latitude: f.checked_lat !== null && f.checked_lat !== undefined ? f.checked_lat : f.latitude,
      longitude: f.checked_lng !== null && f.checked_lng !== undefined ? f.checked_lng : f.longitude,
      checked_on: f.checked_timestamp ? localDate(new Date(f.checked_timestamp)) : null,
      status: checked ? 'checked' : isCurrentPeriod ? 'pending' : 'missed'
    };
  });

  res.json({
    fortnights: fortnightSummaries,
    selected: selectedKey,
    farmers: farmerList
  });
});

// Comprehensive 15-day system audit latest report & findings
app.get('/api/system-audit/latest', authenticateAdmin, (req, res) => {
  res.json(getLatestAudit());
});

// History of past system audits
app.get('/api/system-audit/history', authenticateAdmin, (req, res) => {
  const history = query(`
    SELECT * FROM system_audits
    ORDER BY id DESC LIMIT 50
  `);
  res.json({ history });
});

// Unresolved or filtered audit findings
app.get('/api/system-audit/findings', authenticateAdmin, (req, res) => {
  const status = str(req.query.status);
  const severity = str(req.query.severity);
  const category = str(req.query.category);

  const where = [];
  const params = [];

  if (status && status !== 'ALL') {
    where.push('resolution_status = ?');
    params.push(status);
  }
  if (severity) {
    where.push('severity = ?');
    params.push(severity);
  }
  if (category) {
    where.push('category = ?');
    params.push(category);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const findings = query(`
    SELECT * FROM audit_findings
    ${whereSql}
    ORDER BY CASE severity WHEN 'CRITICAL' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END, id DESC
    LIMIT 200
  `, params);

  res.json({ findings });
});

// Resolve an audit finding
app.post('/api/system-audit/findings/:id/resolve', authenticateAdmin, (req, res) => {
  const findingId = parseInt(req.params.id, 10);
  const finding = queryOne('SELECT * FROM audit_findings WHERE id = ?', [findingId]);
  if (!finding) {
    return fail(res, 404, 'finding_not_found', 'Audit finding not found.');
  }

  const resolutionStatus = str(req.body.status) || 'RESOLVED';
  const notes = str(req.body.notes, 500);
  if (!notes) {
    return fail(res, 400, 'notes_required', 'Resolution documentation notes are required.');
  }

  const now = new Date().toISOString();
  run(`
    UPDATE audit_findings
    SET resolution_status = ?, resolution_notes = ?, resolved_by = ?, resolved_at = ?
    WHERE id = ?
  `, [resolutionStatus, notes, req.user.full_name, now, findingId]);

  logAudit(req.user.id, req.user.full_name, 'AUDIT_FINDING_RESOLVED', 'audit_findings', String(findingId),
    `Marked finding #${findingId} (${finding.check_name}) as ${resolutionStatus}: "${notes}"`);

  const updated = queryOne('SELECT * FROM audit_findings WHERE id = ?', [findingId]);
  broadcastSyncEvent('AUDIT_FINDING_RESOLVED', 'audit_findings', String(findingId), updated, req.body.client_id);
  res.json(updated);
});

// Trigger 15-day audit on demand
app.post('/api/system-audit/trigger', authenticateAdmin, async (req, res) => {
  try {
    const result = await runComprehensiveAudit('manual_admin', req.user.full_name);
    res.json(result);
  } catch (err) {
    fail(res, 500, 'audit_failed', `Audit run failed: ${err.message}`);
  }
});

// =========================================================
// REAL-TIME SYNCHRONIZATION MODULE
// =========================================================

// SSE Endpoint for multi-device live sync
app.get('/api/sync/events', authenticateAdmin, (req, res) => {
  handleSyncEvents(req, res);
});

// Polling fallback endpoint
app.get('/api/sync/poll', authenticateAdmin, (req, res) => {
  handleSyncPoll(req, res);
});

app.get('/api/sync/status', authenticateAdmin, (req, res) => {
  res.json({
    active_clients: getActiveClientCount(),
    server_time: new Date().toISOString()
  });
});

// =========================================================
// DASHBOARD & REPORTS MODULE
// =========================================================

// Date-wise sales & purchase summaries (daily, weekly, monthly)
app.get('/api/reports/date-summary', authenticateAdmin, (req, res) => {
  const from = str(req.query.from);
  const to = str(req.query.to);
  const groupBy = str(req.query.group_by) || 'day'; // 'day', 'week', 'month'

  const where = ["status = 'completed'"];
  const params = [];

  if (from) {
    where.push('collection_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('collection_date <= ?');
    params.push(to);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  // Summary by date/period
  let dateExpr = 'collection_date';
  if (groupBy === 'month') {
    dateExpr = "SUBSTR(collection_date, 1, 7)";
  } else if (groupBy === 'week') {
    dateExpr = "collection_date";
  }

  const periodRows = query(`
    SELECT
      ${dateExpr} AS period,
      COUNT(*) AS total_invoices,
      COUNT(DISTINCT farmer_id) AS active_farmers,
      COALESCE(SUM(quantity_kg), 0) AS total_kg,
      COALESCE(SUM(total_amount), 0) AS total_amount,
      COALESCE(SUM(amount_paid), 0) AS total_paid
    FROM collections
    ${whereSql}
    GROUP BY ${dateExpr}
    ORDER BY period DESC
  `, params);

  // Summary by flower variety
  const flowerBreakdown = query(`
    SELECT
      flower_type,
      COUNT(*) AS entries,
      COALESCE(SUM(quantity_kg), 0) AS total_kg,
      COALESCE(SUM(total_amount), 0) AS total_amount,
      ROUND(AVG(rate_per_kg), 2) AS avg_rate
    FROM collections
    ${whereSql}
    GROUP BY flower_type
    ORDER BY total_kg DESC
  `, params);

  res.json({
    period_summary: periodRows.map(r => ({
      ...r,
      total_kg: round2(r.total_kg),
      total_amount: round2(r.total_amount),
      total_paid: round2(r.total_paid),
      outstanding: round2(r.total_amount - r.total_paid)
    })),
    flower_breakdown: flowerBreakdown.map(r => ({
      ...r,
      total_kg: round2(r.total_kg),
      total_amount: round2(r.total_amount)
    }))
  });
});

// CSV Export for collections (UTF-8 BOM, Tamil strings, sanitized formulas)
app.get('/api/reports/export/collections-csv', authenticateAdmin, (req, res) => {
  const from = str(req.query.from);
  const to = str(req.query.to);
  const where = [];
  const params = [];

  if (from) {
    where.push('c.collection_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('c.collection_date <= ?');
    params.push(to);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = query(`
    SELECT
      c.id, c.collection_date, c.farmer_id, c.farmer_name, f.name_ta, c.farmer_village,
      c.flower_type, c.quantity_kg, c.rate_per_kg, c.total_amount, c.applicable_charges,
      c.net_amount, c.payment_status, c.payment_mode, c.amount_paid, c.status,
      c.collected_by, c.created_at
    FROM collections c
    LEFT JOIN farmers f ON c.farmer_id = f.id
    ${whereSql}
    ORDER BY c.collection_date DESC, c.created_at DESC
  `, params);

  const header = [
    'Invoice Number', 'Collection Date', 'Farmer ID', 'Farmer Name (EN)', 'Farmer Name (TA)',
    'Village', 'Flower Type', 'Quantity (kg)', 'Rate/kg (INR)', 'Total Amount (INR)',
    'Charges (INR)', 'Net Amount (INR)', 'Payment Status', 'Payment Mode', 'Amount Paid (INR)',
    'Status', 'Collected By', 'Timestamp'
  ];

  const data = rows.map(r => [
    r.id, r.collection_date, r.farmer_id, r.farmer_name, r.name_ta || '',
    r.farmer_village, r.flower_type, r.quantity_kg, r.rate_per_kg, r.total_amount,
    r.applicable_charges || 0, r.net_amount || r.total_amount, r.payment_status,
    r.payment_mode, r.amount_paid, r.status, r.collected_by, r.created_at
  ]);

  const filename = `collections_${from || 'all'}_to_${to || 'all'}.csv`;
  sendCsv(res, filename, header, data);
});

// CSV Export for farmer directory
app.get('/api/reports/export/farmers-csv', authenticateAdmin, (req, res) => {
  const rows = query(`
    SELECT
      id, full_name, name_ta, contact_number, village, village_ta, district, state,
      latitude, longitude, location_review_status, last_location_reviewed_at,
      next_location_review_due_at, status, total_collected_kg, total_payout, created_at
    FROM farmers
    ORDER BY full_name COLLATE NOCASE ASC
  `);

  const header = [
    'Farmer ID', 'Name (EN)', 'Name (TA)', 'Phone Number', 'Village (EN)', 'Village (TA)',
    'District', 'State', 'Latitude', 'Longitude', 'Location Review Status', 'Last Reviewed',
    'Next Due', 'Status', 'Total Supplied (kg)', 'Total Payout (INR)', 'Registered Date'
  ];

  const data = rows.map(r => [
    r.id, r.full_name, r.name_ta || '', r.contact_number, r.village, r.village_ta || '',
    r.district, r.state, r.latitude !== null ? r.latitude : '', r.longitude !== null ? r.longitude : '',
    r.location_review_status, r.last_location_reviewed_at || '', r.next_location_review_due_at || '',
    r.status, r.total_collected_kg, r.total_payout, r.created_at.slice(0, 10)
  ]);

  sendCsv(res, `farmers_directory_${localDate()}.csv`, header, data);
});

// Comprehensive Dashboard Statistics (All from actual database records)
app.get('/api/dashboard/stats', authenticateAdmin, (req, res) => {
  refreshLocationReviewStatuses();
  const today = localDate();

  const farmerStats = queryOne(`
    SELECT
      COUNT(*) AS total_farmers,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) AS active_farmers,
      SUM(CASE WHEN location_review_status = 'verified' THEN 1 ELSE 0 END) AS loc_verified,
      SUM(CASE WHEN location_review_status = 'due_soon' THEN 1 ELSE 0 END) AS loc_due_soon,
      SUM(CASE WHEN location_review_status = 'overdue' THEN 1 ELSE 0 END) AS loc_overdue,
      SUM(CASE WHEN location_review_status = 'unavailable' THEN 1 ELSE 0 END) AS loc_unavailable
    FROM farmers
  `);

  const allTimeCollections = queryOne(`
    SELECT
      COUNT(*) AS total_collections,
      COALESCE(SUM(quantity_kg), 0) AS total_kg,
      COALESCE(SUM(total_amount), 0) AS total_amount,
      COALESCE(SUM(amount_paid), 0) AS total_paid
    FROM collections
    WHERE status = 'completed'
  `);

  const todayCollections = queryOne(`
    SELECT
      COUNT(*) AS count,
      COALESCE(SUM(quantity_kg), 0) AS kg,
      COALESCE(SUM(total_amount), 0) AS amount,
      COALESCE(SUM(amount_paid), 0) AS paid
    FROM collections
    WHERE collection_date = ? AND status = 'completed'
  `, [today]);

  const todayFlowers = query(`
    SELECT flower_type, COALESCE(SUM(quantity_kg), 0) as kg, COALESCE(SUM(total_amount), 0) as amount
    FROM collections
    WHERE collection_date = ? AND status = 'completed'
    GROUP BY flower_type
    ORDER BY kg DESC
  `, [today]);

  const auditInfo = getLatestAudit();

  const recentInvoices = query(`
    SELECT id, collection_date, farmer_name, flower_type, quantity_kg, rate_per_kg, total_amount, payment_status, status
    FROM collections
    ORDER BY created_at DESC LIMIT 8
  `);

  const recentFarmers = query(`
    SELECT id, full_name, name_ta, village, contact_number, location_review_status, updated_at
    FROM farmers
    ORDER BY updated_at DESC LIMIT 8
  `);

  const totalAmount = round2(allTimeCollections ? allTimeCollections.total_amount : 0);
  const totalPaid = round2(allTimeCollections ? allTimeCollections.total_paid : 0);
  const pendingAmount = round2(totalAmount - totalPaid);

  res.json({
    farmers: {
      total: farmerStats ? farmerStats.total_farmers : 0,
      active: farmerStats ? farmerStats.active_farmers : 0,
      location_verified: farmerStats ? farmerStats.loc_verified : 0,
      location_due_soon: farmerStats ? farmerStats.loc_due_soon : 0,
      location_overdue: farmerStats ? farmerStats.loc_overdue : 0,
      location_unavailable: farmerStats ? farmerStats.loc_unavailable : 0
    },
    collections: {
      all_time: {
        count: allTimeCollections ? allTimeCollections.total_collections : 0,
        total_kg: round2(allTimeCollections ? allTimeCollections.total_kg : 0),
        total_amount: totalAmount,
        total_paid: totalPaid,
        pending_payout: pendingAmount
      },
      today: {
        count: todayCollections ? todayCollections.count : 0,
        kg: round2(todayCollections ? todayCollections.kg : 0),
        amount: round2(todayCollections ? todayCollections.amount : 0),
        paid: round2(todayCollections ? todayCollections.paid : 0)
      },
      today_flowers: todayFlowers.map(f => ({ flower: f.flower_type, kg: round2(f.kg), amount: round2(f.amount) }))
    },
    audit: {
      last_audit_date: auditInfo.last_audit_date,
      next_scheduled_audit_date: auditInfo.next_scheduled_audit_date,
      unresolved_findings_count: auditInfo.unresolved_count,
      summary: auditInfo.summary
    },
    sync: {
      active_connections: getActiveClientCount(),
      server_time: new Date().toISOString()
    },
    recent_invoices: recentInvoices,
    recent_farmers: recentFarmers
  });
});

// Database Backup (Downloads binary SQLite database)
app.get('/api/backup', authenticateAdmin, (req, res) => {
  logAudit(req.user.id, req.user.full_name, 'FULL_BACKUP_GENERATED', 'system', null, 'Full SQLite database file downloaded');

  if (fs.existsSync(DB_FILE)) {
    const fileBytes = fs.readFileSync(DB_FILE);
    res.setHeader('Content-Type', 'application/vnd.sqlite3');
    res.setHeader('Content-Disposition', `attachment; filename="fresh_blooms_backup_${localDate()}.sqlite"`);
    return res.send(fileBytes);
  }

  // Fallback JSON if file not yet written
  const backup = {
    metadata: { version: '1.0.0', exported_at: new Date().toISOString(), exported_by: req.user.full_name },
    farmers: query('SELECT * FROM farmers'),
    collections: query('SELECT * FROM collections'),
    farmer_locations: query('SELECT * FROM farmer_locations'),
    system_audits: query('SELECT * FROM system_audits'),
    audit_findings: query('SELECT * FROM audit_findings'),
    settings: query('SELECT * FROM settings')
  };
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="fresh_blooms_backup_${localDate()}.json"`);
  res.json(backup);
});

// =========================================================
// FARMER BILLING STATEMENT & SETTLEMENTS (15, 20, 30 DAYS)
// =========================================================

// Single farmer cycle billing statement
app.get('/api/farmers/:id/billing-statement', authenticateAdmin, (req, res) => {
  const farmer = queryOne('SELECT * FROM farmers WHERE id = ?', [req.params.id]);
  if (!farmer) {
    return fail(res, 404, 'farmer_not_found', 'Farmer not found.');
  }

  const cycleDays = [15, 20, 30].includes(farmer.billing_cycle_days) ? farmer.billing_cycle_days : 15;
  const today = localDate();
  const to = str(req.query.to) || today;
  const from = str(req.query.from) || addDays(to, -cycleDays);

  const items = query(`
    SELECT id, collection_date, flower_type, variety, quantity_kg, rate_per_kg,
           total_amount, gross_amount, commission_rate, commission_amount,
           applicable_charges, net_amount, payment_status, payment_mode, amount_paid, created_at
    FROM collections
    WHERE farmer_id = ? AND collection_date >= ? AND collection_date <= ? AND status = 'completed'
    ORDER BY collection_date ASC, created_at ASC
  `, [farmer.id, from, to]);

  let totalKg = 0;
  let totalGross = 0;
  let totalCommission = 0;
  let totalCharges = 0;
  let totalNetPayable = 0;
  let totalPaid = 0;

  for (const it of items) {
    const gross = it.gross_amount || it.total_amount;
    const commRate = it.commission_rate !== undefined && it.commission_rate !== null ? it.commission_rate : (farmer.commission_rate || 10.0);
    const commAmt = it.commission_amount || round2(gross * (commRate / 100));
    const charges = it.applicable_charges || 0;
    const net = round2(gross - commAmt + charges);

    totalKg += it.quantity_kg;
    totalGross += gross;
    totalCommission += commAmt;
    totalCharges += charges;
    totalNetPayable += net;
    totalPaid += (it.amount_paid || 0);
  }

  const balanceDue = round2(totalNetPayable - totalPaid);

  res.json({
    farmer: {
      id: farmer.id,
      full_name: farmer.full_name,
      name_ta: farmer.name_ta,
      contact_number: farmer.contact_number,
      village: farmer.village,
      village_ta: farmer.village_ta,
      district: farmer.district,
      billing_cycle_days: cycleDays,
      commission_rate: farmer.commission_rate || 10.0
    },
    period: {
      from,
      to,
      cycle_days: cycleDays
    },
    items: items.map(it => {
      const gross = it.gross_amount || it.total_amount;
      const commRate = it.commission_rate !== undefined && it.commission_rate !== null ? it.commission_rate : (farmer.commission_rate || 10.0);
      const commAmt = it.commission_amount || round2(gross * (commRate / 100));
      const charges = it.applicable_charges || 0;
      return {
        ...it,
        gross_amount: round2(gross),
        commission_rate: commRate,
        commission_amount: round2(commAmt),
        net_payout: round2(gross - commAmt + charges)
      };
    }),
    totals: {
      entries_count: items.length,
      total_kg: round2(totalKg),
      total_gross: round2(totalGross),
      total_commission: round2(totalCommission),
      total_charges: round2(totalCharges),
      total_net_payable: round2(totalNetPayable),
      total_paid: round2(totalPaid),
      balance_due: balanceDue
    }
  });
});

// Summary overview of all farmers with their billing cycles and pending settlements
app.get('/api/farmers/settlements/summary', authenticateAdmin, (req, res) => {
  const farmers = query(`
    SELECT id, full_name, name_ta, village, contact_number, billing_cycle_days, commission_rate, total_collected_kg, total_payout
    FROM farmers
    WHERE status = 'active'
    ORDER BY full_name COLLATE NOCASE ASC
  `);

  const today = localDate();
  const list = farmers.map(f => {
    const cycle = [15, 20, 30].includes(f.billing_cycle_days) ? f.billing_cycle_days : 15;
    const from = addDays(today, -cycle);

    const periodStats = queryOne(`
      SELECT COUNT(*) AS entries,
             COALESCE(SUM(quantity_kg), 0) AS kg,
             COALESCE(SUM(total_amount), 0) AS gross,
             COALESCE(SUM(amount_paid), 0) AS paid
      FROM collections
      WHERE farmer_id = ? AND collection_date >= ? AND collection_date <= ? AND status = 'completed'
    `, [f.id, from, today]);

    const gross = periodStats ? periodStats.gross : 0;
    const commRate = f.commission_rate || 10.0;
    const commAmt = round2(gross * (commRate / 100));
    const net = round2(gross - commAmt);
    const paid = periodStats ? periodStats.paid : 0;

    return {
      id: f.id,
      full_name: f.full_name,
      name_ta: f.name_ta,
      village: f.village,
      contact_number: f.contact_number,
      billing_cycle_days: cycle,
      commission_rate: commRate,
      current_period: { from, to: today },
      cycle_entries: periodStats ? periodStats.entries : 0,
      cycle_kg: round2(periodStats ? periodStats.kg : 0),
      cycle_gross: round2(gross),
      cycle_commission: round2(commAmt),
      cycle_net_payable: round2(net),
      cycle_paid: round2(paid),
      cycle_balance: round2(net - paid)
    };
  });

  res.json({ farmers: list });
});

// CSV export for farmer settlement statement
app.get('/api/farmers/:id/export-statement-csv', authenticateAdmin, (req, res) => {
  const farmer = queryOne('SELECT * FROM farmers WHERE id = ?', [req.params.id]);
  if (!farmer) return fail(res, 404, 'farmer_not_found', 'Farmer not found.');

  const cycleDays = [15, 20, 30].includes(farmer.billing_cycle_days) ? farmer.billing_cycle_days : 15;
  const today = localDate();
  const to = str(req.query.to) || today;
  const from = str(req.query.from) || addDays(to, -cycleDays);

  const items = query(`
    SELECT id, collection_date, flower_type, variety, quantity_kg, rate_per_kg,
           total_amount, gross_amount, commission_rate, commission_amount, applicable_charges, net_amount, payment_status, payment_mode
    FROM collections
    WHERE farmer_id = ? AND collection_date >= ? AND collection_date <= ? AND status = 'completed'
    ORDER BY collection_date ASC
  `, [farmer.id, from, to]);

  const header = [
    'Bill ID', 'Date', 'Farmer ID', 'Farmer Name', 'Village',
    'Flower Type', 'Variety', 'Weight (kg)', 'Rate/kg (INR)', 'Gross Amount (INR)',
    'Commission %', 'Commission Deducted (INR)', 'Charges (INR)', 'Net Payout (INR)', 'Payment Status'
  ];

  const data = items.map(it => {
    const gross = it.gross_amount || it.total_amount;
    const commRate = it.commission_rate !== undefined && it.commission_rate !== null ? it.commission_rate : (farmer.commission_rate || 10.0);
    const commAmt = it.commission_amount || round2(gross * (commRate / 100));
    const charges = it.applicable_charges || 0;
    const net = round2(gross - commAmt + charges);
    return [
      it.id, it.collection_date, farmer.id, farmer.full_name, farmer.village,
      it.flower_type, it.variety || 'Standard', it.quantity_kg, it.rate_per_kg, gross,
      `${commRate}%`, commAmt, charges, net, it.payment_status
    ];
  });

  sendCsv(res, `farmer_statement_${farmer.id}_${from}_to_${to}.csv`, header, data);
});

// =========================================================
// SELLING MANAGEMENT MODULE - BUYERS DIRECTORY (20-25 BUYERS)
// =========================================================

// List buyers
app.get('/api/buyers', authenticateAdmin, (req, res) => {
  const search = str(req.query.search);
  const city = str(req.query.city);
  const status = str(req.query.status);
  const { page, limit, offset } = pageParams(req, 50, 100);

  const where = [];
  const params = [];

  if (search) {
    where.push('(id LIKE ? OR name LIKE ? OR name_ta LIKE ? OR phone LIKE ? OR market_city LIKE ?)');
    const t = `%${search}%`;
    params.push(t, t, t, t, t);
  }
  if (city) {
    where.push('market_city = ?');
    params.push(city);
  }
  if (status) {
    where.push('status = ?');
    params.push(status);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = queryOne(`SELECT COUNT(*) as count FROM buyers ${whereSql}`, params);
  const total = totalRow ? totalRow.count : 0;

  const summary = queryOne(`
    SELECT COUNT(*) AS total_buyers,
           COALESCE(SUM(outstanding_balance), 0) AS total_outstanding,
           COALESCE(SUM(credit_limit), 0) AS total_credit_limit
    FROM buyers
    WHERE status = 'active'
  `);

  const buyers = query(`
    SELECT * FROM buyers
    ${whereSql}
    ORDER BY name COLLATE NOCASE ASC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  const cityRows = query("SELECT DISTINCT market_city FROM buyers WHERE market_city IS NOT NULL AND market_city != '' ORDER BY market_city ASC");
  const cities = cityRows.map(r => r.market_city);

  res.json({
    buyers,
    cities,
    summary: {
      total_buyers: summary ? summary.total_buyers : 0,
      total_outstanding: round2(summary ? summary.total_outstanding : 0),
      total_credit_limit: round2(summary ? summary.total_credit_limit : 0)
    },
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
  });
});

// Register new buyer
app.post('/api/buyers', authenticateAdmin, (req, res) => {
  const name = str(req.body.name);
  if (!name) return fail(res, 400, 'name_required', 'Buyer business name is required.');

  const nameTa = str(req.body.name_ta);
  const contactPerson = str(req.body.contact_person) || name;
  const phone = cleanPhone(req.body.phone);
  if (!phone) return fail(res, 400, 'invalid_phone', 'A valid 10-digit phone number is required.');

  const marketCity = str(req.body.market_city) || 'Madurai';
  const address = str(req.body.address);
  const creditLimit = Math.max(0, num(req.body.credit_limit) || 100000);
  const billingCycle = [5, 6].includes(parseInt(req.body.billing_cycle_days, 10)) ? parseInt(req.body.billing_cycle_days, 10) : 6;
  const notes = str(req.body.notes, 500);

  const now = new Date().toISOString();
  let buyerRecord = null;

  transaction(() => {
    const buyerId = nextId('buyers', 'BUY-');

    run(`
      INSERT INTO buyers (
        id, name, name_ta, contact_person, phone, market_city, address,
        credit_limit, outstanding_balance, billing_cycle_days, status, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?, ?)
    `, [buyerId, name, nameTa || null, contactPerson, phone, marketCity, address || null, creditLimit, billingCycle, notes || null, now, now]);

    buyerRecord = queryOne('SELECT * FROM buyers WHERE id = ?', [buyerId]);

    logAudit(req.user.id, req.user.full_name, 'BUYER_REGISTERED', 'buyers', buyerId,
      `Registered wholesale buyer ${name} (${marketCity}) with phone ${phone}`, null, buyerRecord);
  });

  broadcastSyncEvent('BUYER_CREATED', 'buyers', buyerRecord.id, buyerRecord, req.body.client_id);
  res.status(201).json(buyerRecord);
});

// Single buyer profile
app.get('/api/buyers/:id', authenticateAdmin, (req, res) => {
  const buyer = queryOne('SELECT * FROM buyers WHERE id = ?', [req.params.id]);
  if (!buyer) return fail(res, 404, 'buyer_not_found', 'Buyer not found.');

  const distributions = query(`
    SELECT * FROM buyer_distributions
    WHERE buyer_id = ?
    ORDER BY distribution_date DESC, created_at DESC
    LIMIT 30
  `, [buyer.id]);

  const bills = query(`
    SELECT * FROM selling_bills
    WHERE buyer_id = ?
    ORDER BY bill_date DESC, created_at DESC
    LIMIT 20
  `, [buyer.id]);

  const unbilledStats = queryOne(`
    SELECT COUNT(*) AS unbilled_count,
           COALESCE(SUM(quantity_kg), 0) AS unbilled_kg,
           COALESCE(SUM(total_amount), 0) AS unbilled_amount
    FROM buyer_distributions
    WHERE buyer_id = ? AND bill_status = 'unbilled'
  `, [buyer.id]);

  res.json({
    ...buyer,
    distributions,
    bills,
    unbilled: {
      count: unbilledStats ? unbilledStats.unbilled_count : 0,
      kg: round2(unbilledStats ? unbilledStats.unbilled_kg : 0),
      amount: round2(unbilledStats ? unbilledStats.unbilled_amount : 0)
    }
  });
});

// Update buyer details
app.put('/api/buyers/:id', authenticateAdmin, (req, res) => {
  const buyer = queryOne('SELECT * FROM buyers WHERE id = ?', [req.params.id]);
  if (!buyer) return fail(res, 404, 'buyer_not_found', 'Buyer not found.');

  const name = str(req.body.name) || buyer.name;
  const nameTa = req.body.name_ta !== undefined ? str(req.body.name_ta) : buyer.name_ta;
  const contactPerson = str(req.body.contact_person) || buyer.contact_person;
  const phone = req.body.phone !== undefined ? cleanPhone(req.body.phone) || buyer.phone : buyer.phone;
  const marketCity = str(req.body.market_city) || buyer.market_city;
  const address = req.body.address !== undefined ? str(req.body.address) : buyer.address;
  const creditLimit = req.body.credit_limit !== undefined ? Math.max(0, num(req.body.credit_limit) || 0) : buyer.credit_limit;
  const billingCycle = req.body.billing_cycle_days !== undefined && [5, 6].includes(parseInt(req.body.billing_cycle_days, 10))
    ? parseInt(req.body.billing_cycle_days, 10)
    : buyer.billing_cycle_days;
  const status = str(req.body.status) || buyer.status;
  const notes = req.body.notes !== undefined ? str(req.body.notes, 500) : buyer.notes;

  const now = new Date().toISOString();
  transaction(() => {
    run(`
      UPDATE buyers
      SET name = ?, name_ta = ?, contact_person = ?, phone = ?, market_city = ?, address = ?,
          credit_limit = ?, billing_cycle_days = ?, status = ?, notes = ?, updated_at = ?
      WHERE id = ?
    `, [name, nameTa || null, contactPerson, phone, marketCity, address || null, creditLimit, billingCycle, status, notes || null, now, buyer.id]);

    logAudit(req.user.id, req.user.full_name, 'BUYER_UPDATED', 'buyers', buyer.id,
      `Updated wholesale buyer ${name} (${buyer.id})`, buyer, req.body);
  });

  const updated = queryOne('SELECT * FROM buyers WHERE id = ?', [buyer.id]);
  broadcastSyncEvent('BUYER_UPDATED', 'buyers', updated.id, updated, req.body.client_id);
  res.json(updated);
});

// Record customer payment on outstanding balance
app.post('/api/buyers/:id/payment', authenticateAdmin, (req, res) => {
  const buyer = queryOne('SELECT * FROM buyers WHERE id = ?', [req.params.id]);
  if (!buyer) return fail(res, 404, 'buyer_not_found', 'Buyer not found.');

  const amount = Math.max(0, num(req.body.amount) || 0);
  if (amount <= 0) return fail(res, 400, 'invalid_amount', 'Payment amount must be greater than 0.');

  const paymentMode = str(req.body.payment_mode) || 'Cash';
  const notes = str(req.body.notes, 300);
  const newBalance = Math.max(0, round2(buyer.outstanding_balance - amount));

  const now = new Date().toISOString();
  transaction(() => {
    run('UPDATE buyers SET outstanding_balance = ?, updated_at = ? WHERE id = ?', [newBalance, now, buyer.id]);

    logAudit(req.user.id, req.user.full_name, 'BUYER_PAYMENT_RECEIVED', 'buyers', buyer.id,
      `Received ₹${amount} payment via ${paymentMode} from ${buyer.name}. Previous Bal: ₹${buyer.outstanding_balance}, New Bal: ₹${newBalance}`);
  });

  const updated = queryOne('SELECT * FROM buyers WHERE id = ?', [buyer.id]);
  broadcastSyncEvent('BUYER_UPDATED', 'buyers', updated.id, updated, req.body.client_id);
  res.json({ success: true, buyer: updated, amount_paid: amount, new_balance: newBalance });
});

// =========================================================
// FLOWER DISTRIBUTION MODULE (TRACKED FROM ORIGIN LOCATIONS)
// =========================================================

// List distributions
app.get('/api/selling/distributions', authenticateAdmin, (req, res) => {
  const buyerId = str(req.query.buyer_id);
  const location = str(req.query.procurement_location);
  const flower = str(req.query.flower_type);
  const billStatus = str(req.query.bill_status);
  const from = str(req.query.from);
  const to = str(req.query.to);
  const search = str(req.query.search);
  const { page, limit, offset } = pageParams(req, 50, 200);

  const where = [];
  const params = [];

  if (buyerId) {
    where.push('buyer_id = ?');
    params.push(buyerId);
  }
  if (location) {
    where.push('procurement_location = ?');
    params.push(location);
  }
  if (flower) {
    where.push('flower_type = ?');
    params.push(flower);
  }
  if (billStatus) {
    where.push('bill_status = ?');
    params.push(billStatus);
  }
  if (from) {
    where.push('distribution_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('distribution_date <= ?');
    params.push(to);
  }
  if (search) {
    where.push('(id LIKE ? OR buyer_name LIKE ? OR vehicle_number LIKE ?)');
    const t = `%${search}%`;
    params.push(t, t, t);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = queryOne(`SELECT COUNT(*) as count FROM buyer_distributions ${whereSql}`, params);
  const total = totalRow ? totalRow.count : 0;

  const stats = queryOne(`
    SELECT COUNT(*) AS total_count,
           COALESCE(SUM(quantity_kg), 0) AS total_kg,
           COALESCE(SUM(total_amount), 0) AS total_amount,
           COALESCE(SUM(coolie_charges), 0) AS total_coolie,
           COALESCE(SUM(transport_charges), 0) AS total_transport,
           COALESCE(SUM(CASE WHEN bill_status = 'unbilled' THEN quantity_kg ELSE 0 END), 0) AS unbilled_kg,
           COALESCE(SUM(CASE WHEN bill_status = 'unbilled' THEN total_amount ELSE 0 END), 0) AS unbilled_amount
    FROM buyer_distributions
    ${whereSql}
  `, params);

  const distributions = query(`
    SELECT * FROM buyer_distributions
    ${whereSql}
    ORDER BY distribution_date DESC, created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  res.json({
    distributions,
    totals: {
      count: stats ? stats.total_count : 0,
      total_kg: round2(stats ? stats.total_kg : 0),
      total_amount: round2(stats ? stats.total_amount : 0),
      total_coolie: round2(stats ? stats.total_coolie : 0),
      total_transport: round2(stats ? stats.total_transport : 0),
      unbilled_kg: round2(stats ? stats.unbilled_kg : 0),
      unbilled_amount: round2(stats ? stats.unbilled_amount : 0)
    },
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
  });
});

// Record new flower distribution to buyer
app.post('/api/selling/distributions', authenticateAdmin, (req, res) => {
  const buyerId = str(req.body.buyer_id);
  if (!buyerId) return fail(res, 400, 'buyer_required', 'Buyer selection is required.');

  const buyer = queryOne('SELECT id, name FROM buyers WHERE id = ?', [buyerId]);
  if (!buyer) return fail(res, 404, 'buyer_not_found', 'Selected buyer not found.');

  const procurementLocation = str(req.body.procurement_location);
  if (!procurementLocation) return fail(res, 400, 'location_required', 'Procurement origin location is required (e.g. Thovalai, Nilakottai).');

  const flowerType = str(req.body.flower_type);
  if (!flowerType || !FLOWERS.includes(flowerType)) {
    return fail(res, 400, 'invalid_flower', `Flower type must be one of: ${FLOWERS.join(', ')}.`);
  }

  const quantity = num(req.body.quantity_kg);
  if (isNaN(quantity) || quantity <= 0) return fail(res, 400, 'invalid_weight', 'Quantity must be greater than 0.');

  const rate = num(req.body.rate_per_kg);
  if (isNaN(rate) || rate <= 0) return fail(res, 400, 'invalid_rate', 'Rate per kg must be greater than 0.');

  const today = localDate();
  const distributionDate = str(req.body.distribution_date) || today;
  if (!isDateStr(distributionDate)) return fail(res, 400, 'invalid_date', 'Distribution date must be valid YYYY-MM-DD.');

  const variety = str(req.body.variety, 100);
  const coolieCharges = Math.max(0, num(req.body.coolie_charges) || 0);
  const transportCharges = Math.max(0, num(req.body.transport_charges) || 0);
  const totalAmount = round2(quantity * rate);
  const vehicleNumber = str(req.body.vehicle_number, 30);
  const notes = str(req.body.notes, 500);

  const now = new Date().toISOString();
  const year = distributionDate.slice(0, 4);
  let distRecord = null;

  transaction(() => {
    const distId = nextId('buyer_distributions', `DIST-${year}-`);

    run(`
      INSERT INTO buyer_distributions (
        id, distribution_date, buyer_id, buyer_name, procurement_location, flower_type, variety,
        quantity_kg, rate_per_kg, total_amount, coolie_charges, transport_charges,
        dispatch_status, bill_status, vehicle_number, notes, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', 'unbilled', ?, ?, ?, ?)
    `, [
      distId, distributionDate, buyer.id, buyer.name, procurementLocation, flowerType, variety || null,
      round2(quantity), round2(rate), totalAmount, coolieCharges, transportCharges,
      vehicleNumber || null, notes || null, now, now
    ]);

    // Update buyer balance
    const netItemDue = round2(totalAmount + coolieCharges + transportCharges);
    run('UPDATE buyers SET outstanding_balance = outstanding_balance + ?, updated_at = ? WHERE id = ?', [netItemDue, now, buyer.id]);

    distRecord = queryOne('SELECT * FROM buyer_distributions WHERE id = ?', [distId]);

    logAudit(req.user.id, req.user.full_name, 'FLOWER_DISTRIBUTED', 'buyer_distributions', distId,
      `Distributed ${quantity}kg ${flowerType} from ${procurementLocation} to ${buyer.name} @ ₹${rate} = ₹${totalAmount}`, null, distRecord);
  });

  broadcastSyncEvent('DISTRIBUTION_CREATED', 'buyer_distributions', distRecord.id, distRecord, req.body.client_id);
  res.status(201).json(distRecord);
});

// Delete / reverse distribution
app.delete('/api/selling/distributions/:id', authenticateAdmin, (req, res) => {
  const dist = queryOne('SELECT * FROM buyer_distributions WHERE id = ?', [req.params.id]);
  if (!dist) return fail(res, 404, 'distribution_not_found', 'Distribution record not found.');
  if (dist.bill_status === 'billed') {
    return fail(res, 400, 'already_billed', 'Cannot delete distribution that has already been consolidated into an invoice.');
  }

  const now = new Date().toISOString();
  transaction(() => {
    const netItemDue = round2(dist.total_amount + (dist.coolie_charges || 0) + (dist.transport_charges || 0));
    run('UPDATE buyers SET outstanding_balance = MAX(0, outstanding_balance - ?), updated_at = ? WHERE id = ?', [netItemDue, now, dist.buyer_id]);
    run('DELETE FROM buyer_distributions WHERE id = ?', [dist.id]);

    logAudit(req.user.id, req.user.full_name, 'DISTRIBUTION_REVERSED', 'buyer_distributions', dist.id,
      `Reversed distribution ${dist.id} of ${dist.quantity_kg}kg ${dist.flower_type} from ${dist.procurement_location} to ${dist.buyer_name}`);
  });

  broadcastSyncEvent('DISTRIBUTION_DELETED', 'buyer_distributions', dist.id, { id: dist.id }, req.body.client_id);
  res.json({ success: true, message: `Distribution ${dist.id} cancelled successfully.` });
});

// Summary breakdown of distributions (by procurement origin location & flower)
app.get('/api/selling/distributions/summary', authenticateAdmin, (req, res) => {
  const from = str(req.query.from);
  const to = str(req.query.to);
  const where = [];
  const params = [];

  if (from) {
    where.push('distribution_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('distribution_date <= ?');
    params.push(to);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const locationBreakdown = query(`
    SELECT procurement_location,
           COUNT(*) AS dispatch_count,
           COUNT(DISTINCT buyer_id) AS buyers_served,
           COALESCE(SUM(quantity_kg), 0) AS total_kg,
           COALESCE(SUM(total_amount), 0) AS total_amount,
           ROUND(AVG(rate_per_kg), 2) AS avg_rate
    FROM buyer_distributions
    ${whereSql}
    GROUP BY procurement_location
    ORDER BY total_kg DESC
  `, params);

  const flowerBreakdown = query(`
    SELECT flower_type,
           COUNT(*) AS entries,
           COALESCE(SUM(quantity_kg), 0) AS total_kg,
           COALESCE(SUM(total_amount), 0) AS total_amount,
           ROUND(AVG(rate_per_kg), 2) AS avg_rate
    FROM buyer_distributions
    ${whereSql}
    GROUP BY flower_type
    ORDER BY total_kg DESC
  `, params);

  const buyerBreakdown = query(`
    SELECT buyer_id, buyer_name,
           COUNT(*) AS dispatches,
           COALESCE(SUM(quantity_kg), 0) AS total_kg,
           COALESCE(SUM(total_amount), 0) AS total_amount
    FROM buyer_distributions
    ${whereSql}
    GROUP BY buyer_id
    ORDER BY total_amount DESC
    LIMIT 15
  `, params);

  res.json({
    location_breakdown: locationBreakdown.map(l => ({ ...l, total_kg: round2(l.total_kg), total_amount: round2(l.total_amount) })),
    flower_breakdown: flowerBreakdown.map(f => ({ ...f, total_kg: round2(f.total_kg), total_amount: round2(f.total_amount) })),
    buyer_breakdown: buyerBreakdown.map(b => ({ ...b, total_kg: round2(b.total_kg), total_amount: round2(b.total_amount) }))
  });
});

// =========================================================
// CONSOLIDATED 5-6 DAY SELLING BILLS MODULE
// =========================================================

// Get unbilled distributions for a buyer in date range
app.get('/api/selling/unbilled-distributions', authenticateAdmin, (req, res) => {
  const buyerId = str(req.query.buyer_id);
  if (!buyerId) return fail(res, 400, 'buyer_required', 'Buyer ID is required.');

  const buyer = queryOne('SELECT * FROM buyers WHERE id = ?', [buyerId]);
  if (!buyer) return fail(res, 404, 'buyer_not_found', 'Buyer not found.');

  const from = str(req.query.from);
  const to = str(req.query.to);

  const where = ['buyer_id = ?', "bill_status = 'unbilled'"];
  const params = [buyerId];

  if (from) {
    where.push('distribution_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('distribution_date <= ?');
    params.push(to);
  }

  const items = query(`
    SELECT * FROM buyer_distributions
    WHERE ${where.join(' AND ')}
    ORDER BY distribution_date ASC, created_at ASC
  `, params);

  let totalKg = 0;
  let totalAmount = 0;
  let totalCoolie = 0;
  let totalTransport = 0;

  for (const it of items) {
    totalKg += it.quantity_kg;
    totalAmount += it.total_amount;
    totalCoolie += (it.coolie_charges || 0);
    totalTransport += (it.transport_charges || 0);
  }

  res.json({
    buyer,
    items,
    totals: {
      count: items.length,
      total_kg: round2(totalKg),
      total_amount: round2(totalAmount),
      total_coolie: round2(totalCoolie),
      total_transport: round2(totalTransport)
    }
  });
});

// Generate consolidated 5-6 day selling bill
app.post('/api/selling/bills/generate', authenticateAdmin, (req, res) => {
  const buyerId = str(req.body.buyer_id);
  if (!buyerId) return fail(res, 400, 'buyer_required', 'Buyer ID is required.');

  const buyer = queryOne('SELECT * FROM buyers WHERE id = ?', [buyerId]);
  if (!buyer) return fail(res, 404, 'buyer_not_found', 'Buyer not found.');

  const periodStart = str(req.body.period_start_date);
  const periodEnd = str(req.body.period_end_date);
  if (!isDateStr(periodStart) || !isDateStr(periodEnd)) {
    return fail(res, 400, 'invalid_period', 'Valid period start and end dates (YYYY-MM-DD) are required.');
  }

  const today = localDate();
  const billDate = str(req.body.bill_date) || today;
  const cycleDays = daysBetween(periodStart, periodEnd) + 1;

  // Find unbilled distributions
  const items = query(`
    SELECT * FROM buyer_distributions
    WHERE buyer_id = ? AND bill_status = 'unbilled' AND distribution_date >= ? AND distribution_date <= ?
    ORDER BY distribution_date ASC, created_at ASC
  `, [buyer.id, periodStart, periodEnd]);

  if (items.length === 0) {
    return fail(res, 400, 'no_distributions', 'No unbilled flower distributions found for this buyer in the selected 5-6 day period.');
  }

  let totalKg = 0;
  let grossFlowerAmount = 0;
  let autoCoolie = 0;
  let autoTransport = 0;

  for (const it of items) {
    totalKg += it.quantity_kg;
    grossFlowerAmount += it.total_amount;
    autoCoolie += (it.coolie_charges || 0);
    autoTransport += (it.transport_charges || 0);
  }

  const coolieCharges = req.body.coolie_charges !== undefined ? Math.max(0, num(req.body.coolie_charges) || 0) : autoCoolie;
  const transportCharges = req.body.transport_charges !== undefined ? Math.max(0, num(req.body.transport_charges) || 0) : autoTransport;
  const otherCharges = Math.max(0, num(req.body.other_charges) || 0);
  const discountAmount = Math.max(0, num(req.body.discount_amount) || 0);

  const subtotal = round2(grossFlowerAmount + coolieCharges + transportCharges + otherCharges - discountAmount);
  // Previous balance from buyer record (minus items if already added)
  const previousBalance = round2(buyer.outstanding_balance - (grossFlowerAmount + autoCoolie + autoTransport));
  const totalPayable = round2(subtotal + Math.max(0, previousBalance));
  const amountPaid = Math.max(0, num(req.body.amount_paid) || 0);
  const balanceDue = round2(totalPayable - amountPaid);
  const paymentStatus = balanceDue <= 0 ? 'Paid' : amountPaid > 0 ? 'Partial' : 'Pending';
  const paymentMode = str(req.body.payment_mode) || 'Cash';
  const notes = str(req.body.notes, 500);

  const now = new Date().toISOString();
  const year = billDate.slice(0, 4);
  let createdBill = null;

  transaction(() => {
    const billId = nextId('selling_bills', `SB-${year}-`);

    run(`
      INSERT INTO selling_bills (
        id, bill_number, buyer_id, buyer_name, billing_cycle_days, period_start_date, period_end_date,
        bill_date, total_kg, gross_flower_amount, coolie_charges, transport_charges, other_charges,
        discount_amount, subtotal_amount, previous_balance, total_payable, amount_paid, balance_due,
        payment_status, payment_mode, notes, created_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
      billId, billId, buyer.id, buyer.name, cycleDays, periodStart, periodEnd,
      billDate, round2(totalKg), round2(grossFlowerAmount), round2(coolieCharges), round2(transportCharges), round2(otherCharges),
      round2(discountAmount), subtotal, round2(previousBalance), totalPayable, amountPaid, balanceDue,
      paymentStatus, paymentMode, notes || null, req.user.full_name, now, now
    ]);

    for (const it of items) {
      run(`
        INSERT INTO selling_bill_items (
          selling_bill_id, distribution_id, item_date, procurement_location, flower_type, variety,
          quantity_kg, rate_per_kg, total_amount, coolie_charges, transport_charges
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        billId, it.id, it.distribution_date, it.procurement_location, it.flower_type, it.variety,
        it.quantity_kg, it.rate_per_kg, it.total_amount, it.coolie_charges || 0, it.transport_charges || 0
      ]);

      run("UPDATE buyer_distributions SET bill_status = 'billed', selling_bill_id = ?, updated_at = ? WHERE id = ?", [billId, now, it.id]);
    }

    // Update buyer's actual outstanding balance
    run('UPDATE buyers SET outstanding_balance = ?, updated_at = ? WHERE id = ?', [balanceDue, now, buyer.id]);

    createdBill = queryOne('SELECT * FROM selling_bills WHERE id = ?', [billId]);

    logAudit(req.user.id, req.user.full_name, 'SELLING_BILL_GENERATED', 'selling_bills', billId,
      `Generated ${cycleDays}-day consolidated selling bill ${billId} for ${buyer.name}: ${totalKg}kg flowers = ₹${totalPayable} (Paid: ₹${amountPaid}, Due: ₹${balanceDue})`,
      null, createdBill);
  });

  const billItems = query('SELECT * FROM selling_bill_items WHERE selling_bill_id = ? ORDER BY item_date ASC', [createdBill.id]);
  broadcastSyncEvent('SELLING_BILL_CREATED', 'selling_bills', createdBill.id, createdBill, req.body.client_id);
  res.status(201).json({ ...createdBill, buyer, items: billItems });
});

// List consolidated selling bills
app.get('/api/selling/bills', authenticateAdmin, (req, res) => {
  const buyerId = str(req.query.buyer_id);
  const paymentStatus = str(req.query.payment_status);
  const search = str(req.query.search);
  const from = str(req.query.from);
  const to = str(req.query.to);
  const { page, limit, offset } = pageParams(req, 50, 100);

  const where = [];
  const params = [];

  if (buyerId) {
    where.push('buyer_id = ?');
    params.push(buyerId);
  }
  if (paymentStatus) {
    where.push('payment_status = ?');
    params.push(paymentStatus);
  }
  if (from) {
    where.push('bill_date >= ?');
    params.push(from);
  }
  if (to) {
    where.push('bill_date <= ?');
    params.push(to);
  }
  if (search) {
    where.push('(id LIKE ? OR bill_number LIKE ? OR buyer_name LIKE ?)');
    const t = `%${search}%`;
    params.push(t, t, t);
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const totalRow = queryOne(`SELECT COUNT(*) as count FROM selling_bills ${whereSql}`, params);
  const total = totalRow ? totalRow.count : 0;

  const stats = queryOne(`
    SELECT COUNT(*) AS total_bills,
           COALESCE(SUM(total_kg), 0) AS total_kg,
           COALESCE(SUM(total_payable), 0) AS total_billed,
           COALESCE(SUM(amount_paid), 0) AS total_collected,
           COALESCE(SUM(balance_due), 0) AS total_due
    FROM selling_bills
    ${whereSql}
  `, params);

  const bills = query(`
    SELECT * FROM selling_bills
    ${whereSql}
    ORDER BY bill_date DESC, created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limit, offset]);

  res.json({
    bills,
    totals: {
      count: stats ? stats.total_bills : 0,
      total_kg: round2(stats ? stats.total_kg : 0),
      total_billed: round2(stats ? stats.total_billed : 0),
      total_collected: round2(stats ? stats.total_collected : 0),
      total_due: round2(stats ? stats.total_due : 0)
    },
    pagination: { total, page, limit, totalPages: Math.ceil(total / limit) }
  });
});

// Single selling bill with items and buyer details (Existing Client Format)
app.get('/api/selling/bills/:id', authenticateAdmin, (req, res) => {
  const bill = queryOne('SELECT * FROM selling_bills WHERE id = ?', [req.params.id]);
  if (!bill) return fail(res, 404, 'bill_not_found', 'Selling bill not found.');

  const buyer = queryOne('SELECT * FROM buyers WHERE id = ?', [bill.buyer_id]);
  const items = query('SELECT * FROM selling_bill_items WHERE selling_bill_id = ? ORDER BY item_date ASC, id ASC', [bill.id]);

  res.json({
    bill,
    buyer,
    items,
    shop: {
      name: 'Fresh Blooms Wholesale Flower Commission Mandi',
      name_ta: 'பிரஷ் ப்ளூம்ஸ் மொத்த மலர் வணிகம் & கமிஷன் மண்டி',
      gstin: '33AAAAF0000A1Z5',
      address: 'Main Market Road, Thovalai & Mattuthavani Flower Market, Madurai',
      phone: '+91 98765 43210',
      upi: '9876543210@upi'
    }
  });
});

// Record payment on selling bill
app.post('/api/selling/bills/:id/payment', authenticateAdmin, (req, res) => {
  const bill = queryOne('SELECT * FROM selling_bills WHERE id = ?', [req.params.id]);
  if (!bill) return fail(res, 404, 'bill_not_found', 'Selling bill not found.');

  const amount = Math.max(0, num(req.body.amount) || 0);
  if (amount <= 0) return fail(res, 400, 'invalid_amount', 'Payment amount must be greater than 0.');

  const paymentMode = str(req.body.payment_mode) || 'Cash';
  const newPaid = round2(bill.amount_paid + amount);
  const newBalance = Math.max(0, round2(bill.total_payable - newPaid));
  const newStatus = newBalance <= 0 ? 'Paid' : 'Partial';

  const now = new Date().toISOString();
  transaction(() => {
    run(`
      UPDATE selling_bills
      SET amount_paid = ?, balance_due = ?, payment_status = ?, payment_mode = ?, updated_at = ?
      WHERE id = ?
    `, [newPaid, newBalance, newStatus, paymentMode, now, bill.id]);

    run('UPDATE buyers SET outstanding_balance = MAX(0, outstanding_balance - ?), updated_at = ? WHERE id = ?', [amount, now, bill.buyer_id]);

    logAudit(req.user.id, req.user.full_name, 'SELLING_BILL_PAYMENT', 'selling_bills', bill.id,
      `Recorded payment of ₹${amount} on bill ${bill.id}. Paid: ₹${newPaid}, Balance Due: ₹${newBalance}`);
  });

  const updated = queryOne('SELECT * FROM selling_bills WHERE id = ?', [bill.id]);
  broadcastSyncEvent('SELLING_BILL_UPDATED', 'selling_bills', updated.id, updated, req.body.client_id);
  res.json(updated);
});

// Single Selling Bill Export to Excel (.xls/csv format with complete itemization)
app.get('/api/selling/bills/:id/export-excel', authenticateAdmin, (req, res) => {
  const bill = queryOne('SELECT * FROM selling_bills WHERE id = ?', [req.params.id]);
  if (!bill) return fail(res, 404, 'bill_not_found', 'Selling bill not found.');

  const buyer = queryOne('SELECT * FROM buyers WHERE id = ?', [bill.buyer_id]);
  const items = query('SELECT * FROM selling_bill_items WHERE selling_bill_id = ? ORDER BY item_date ASC', [bill.id]);

  const header = [
    'Date', 'Procurement Origin', 'Flower Variety', 'Weight (kg)',
    'Rate/kg (INR)', 'Coolie (INR)', 'Transport (INR)', 'Daily Line Total (INR)'
  ];

  const data = items.map(it => [
    it.item_date, it.procurement_location, `${it.flower_type} - ${it.variety || 'Grade A'}`,
    it.quantity_kg, it.rate_per_kg, it.coolie_charges || 0, it.transport_charges || 0, it.total_amount
  ]);

  // Append summary rows
  data.push(['---', '---', '---', '---', '---', '---', '---', '---']);
  data.push(['', '', 'TOTAL FLOWER WEIGHT (kg):', bill.total_kg, '', '', 'GROSS FLOWERS:', bill.gross_flower_amount]);
  data.push(['', '', '', '', '', '', 'COOLIE & HANDLING:', bill.coolie_charges]);
  data.push(['', '', '', '', '', '', 'TRANSPORT & FREIGHT:', bill.transport_charges]);
  data.push(['', '', '', '', '', '', 'BILL SUBTOTAL:', bill.subtotal_amount]);
  data.push(['', '', '', '', '', '', 'PREVIOUS BALANCE:', bill.previous_balance]);
  data.push(['', '', '', '', '', '', 'NET TOTAL PAYABLE:', bill.total_payable]);
  data.push(['', '', '', '', '', '', 'AMOUNT PAID:', bill.amount_paid]);
  data.push(['', '', '', '', '', '', 'BALANCE DUE (INR):', bill.balance_due]);

  const filename = `selling_bill_${bill.id}_${buyer ? buyer.name.replace(/\s+/g, '_') : 'buyer'}.csv`;
  sendCsv(res, filename, header, data);
});

// =========================================================
// EXCEL & CSV EXPORT / IMPORT HUB
// =========================================================

// CSV export for buyers directory
app.get('/api/reports/export/buyers-csv', authenticateAdmin, (req, res) => {
  const rows = query('SELECT * FROM buyers ORDER BY name COLLATE NOCASE ASC');

  const header = [
    'Buyer ID', 'Business Name (EN)', 'Name (TA)', 'Contact Person', 'Phone Number',
    'Market / City', 'Address', 'Credit Limit (INR)', 'Outstanding Balance (INR)',
    'Billing Cycle (Days)', 'Status', 'Registered Date'
  ];

  const data = rows.map(r => [
    r.id, r.name, r.name_ta || '', r.contact_person || '', r.phone,
    r.market_city, r.address || '', r.credit_limit, r.outstanding_balance,
    `${r.billing_cycle_days || 6} Days`, r.status, r.created_at.slice(0, 10)
  ]);

  sendCsv(res, `wholesale_buyers_directory_${localDate()}.csv`, header, data);
});

// CSV export for flower distributions
app.get('/api/reports/export/distributions-csv', authenticateAdmin, (req, res) => {
  const from = str(req.query.from);
  const to = str(req.query.to);
  const where = [];
  const params = [];

  if (from) { where.push('distribution_date >= ?'); params.push(from); }
  if (to) { where.push('distribution_date <= ?'); params.push(to); }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = query(`SELECT * FROM buyer_distributions ${whereSql} ORDER BY distribution_date DESC, created_at DESC`, params);

  const header = [
    'Distribution ID', 'Date', 'Buyer ID', 'Buyer Name', 'Procurement Origin',
    'Flower Type', 'Variety', 'Quantity (kg)', 'Rate/kg (INR)', 'Total Amount (INR)',
    'Coolie (INR)', 'Transport (INR)', 'Vehicle Number', 'Bill Status', 'Selling Bill ID'
  ];

  const data = rows.map(r => [
    r.id, r.distribution_date, r.buyer_id, r.buyer_name, r.procurement_location,
    r.flower_type, r.variety || '', r.quantity_kg, r.rate_per_kg, r.total_amount,
    r.coolie_charges || 0, r.transport_charges || 0, r.vehicle_number || '', r.bill_status, r.selling_bill_id || ''
  ]);

  sendCsv(res, `flower_distributions_${from || 'all'}_to_${to || 'all'}.csv`, header, data);
});

// CSV export for consolidated selling bills
app.get('/api/reports/export/selling-bills-csv', authenticateAdmin, (req, res) => {
  const from = str(req.query.from);
  const to = str(req.query.to);
  const where = [];
  const params = [];

  if (from) { where.push('bill_date >= ?'); params.push(from); }
  if (to) { where.push('bill_date <= ?'); params.push(to); }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const rows = query(`SELECT * FROM selling_bills ${whereSql} ORDER BY bill_date DESC, created_at DESC`, params);

  const header = [
    'Bill Number', 'Bill Date', 'Buyer ID', 'Buyer Name', 'Billing Cycle',
    'Period Start', 'Period End', 'Total Weight (kg)', 'Gross Flowers (INR)',
    'Coolie (INR)', 'Transport (INR)', 'Subtotal (INR)', 'Previous Balance (INR)',
    'Total Payable (INR)', 'Amount Paid (INR)', 'Balance Due (INR)', 'Payment Status', 'Payment Mode'
  ];

  const data = rows.map(r => [
    r.bill_number, r.bill_date, r.buyer_id, r.buyer_name, `${r.billing_cycle_days} Days`,
    r.period_start_date, r.period_end_date, r.total_kg, r.gross_flower_amount,
    r.coolie_charges, r.transport_charges, r.subtotal_amount, r.previous_balance,
    r.total_payable, r.amount_paid, r.balance_due, r.payment_status, r.payment_mode
  ]);

  sendCsv(res, `consolidated_selling_bills_${localDate()}.csv`, header, data);
});

// Parse CSV helper function
function parseCsvRows(text) {
  if (!text || typeof text !== 'string') return [];
  const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
  if (lines.length < 2) return [];

  function parseLine(line) {
    const row = [];
    let insideQuote = false;
    let entry = '';
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') {
        if (insideQuote && line[i + 1] === '"') {
          entry += '"';
          i++;
        } else {
          insideQuote = !insideQuote;
        }
      } else if (c === ',' && !insideQuote) {
        row.push(entry.trim());
        entry = '';
      } else {
        entry += c;
      }
    }
    row.push(entry.trim());
    return row;
  }

  const rawHeaders = parseLine(lines[0]);
  const headers = rawHeaders.map(h => h.replace(/^['"]+|['"]+$/g, '').toLowerCase().replace(/[^a-z0-9]/g, '_'));
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseLine(lines[i]);
    const obj = {};
    headers.forEach((h, idx) => {
      let val = values[idx] !== undefined ? values[idx].replace(/^'+/, '').replace(/^"|"$/g, '') : '';
      obj[h] = val;
    });
    rows.push(obj);
  }
  return rows;
}

// Bulk Import Farmers from CSV/Excel data
app.post('/api/import/farmers', authenticateAdmin, (req, res) => {
  let records = Array.isArray(req.body.rows) ? req.body.rows : parseCsvRows(req.body.csv);
  if (!records || records.length === 0) {
    return fail(res, 400, 'no_data', 'No valid farmer rows provided to import.');
  }

  const now = new Date().toISOString();
  const today = localDate();
  let importedCount = 0;
  let updatedCount = 0;
  const errors = [];

  transaction(() => {
    records.forEach((r, idx) => {
      const fullName = str(r.full_name || r.name || r.farmer_name || r.name__en_);
      const contact = cleanPhone(r.contact_number || r.phone || r.mobile || r.phone_number);
      const village = str(r.village || r.locality || r.village__en_) || 'Thovalai';

      if (!fullName || !contact) {
        errors.push(`Row ${idx + 1}: Name and valid 10-digit phone number are required.`);
        return;
      }

      const cycle = [15, 20, 30].includes(parseInt(r.billing_cycle_days || r.billing_cycle, 10)) ? parseInt(r.billing_cycle_days || r.billing_cycle, 10) : 15;
      const commission = !isNaN(Number(r.commission_rate || r.commission)) ? Math.max(0, Math.min(100, Number(r.commission_rate || r.commission))) : 10.0;
      const district = str(r.district) || 'Kanyakumari';
      const address = str(r.address) || null;
      const nameTa = str(r.name_ta || r.name__ta_) || null;

      const existing = queryOne('SELECT id FROM farmers WHERE contact_number = ?', [contact]);
      if (existing) {
        run(`
          UPDATE farmers SET full_name = ?, name_ta = ?, village = ?, district = ?, address = ?,
                 billing_cycle_days = ?, commission_rate = ?, updated_at = ?
          WHERE id = ?
        `, [fullName, nameTa, village, district, address, cycle, commission, now, existing.id]);
        updatedCount++;
      } else {
        const farmerId = nextId('farmers', 'FAR-');
        run(`
          INSERT INTO farmers (
            id, full_name, name_ta, contact_number, village, address, district, state,
            billing_cycle_days, commission_rate, status, total_collected_kg, total_payout, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'Tamil Nadu', ?, ?, 'active', 0, 0, 1, ?, ?)
        `, [farmerId, fullName, nameTa, contact, village, address, district, cycle, commission, now, now]);
        importedCount++;
      }
    });

    logAudit(req.user.id, req.user.full_name, 'FARMERS_BULK_IMPORTED', 'farmers', null,
      `Imported ${importedCount} new farmers and updated ${updatedCount} existing farmers.`);
  });

  res.json({ success: true, imported: importedCount, updated: updatedCount, errors });
});

// Bulk Import Buyers from CSV/Excel data
app.post('/api/import/buyers', authenticateAdmin, (req, res) => {
  let records = Array.isArray(req.body.rows) ? req.body.rows : parseCsvRows(req.body.csv);
  if (!records || records.length === 0) {
    return fail(res, 400, 'no_data', 'No valid buyer rows provided to import.');
  }

  const now = new Date().toISOString();
  let importedCount = 0;
  let updatedCount = 0;
  const errors = [];

  transaction(() => {
    records.forEach((r, idx) => {
      const name = str(r.business_name || r.name || r.buyer_name || r.name__en_);
      const phone = cleanPhone(r.phone || r.contact_number || r.mobile || r.phone_number);
      const city = str(r.market_city || r.city || r.market___city) || 'Madurai';

      if (!name || !phone) {
        errors.push(`Row ${idx + 1}: Buyer name and valid 10-digit phone number are required.`);
        return;
      }

      const cycle = [5, 6].includes(parseInt(r.billing_cycle_days || r.billing_cycle, 10)) ? parseInt(r.billing_cycle_days || r.billing_cycle, 10) : 6;
      const creditLimit = Math.max(0, num(r.credit_limit || r.limit) || 100000);
      const nameTa = str(r.name_ta || r.name__ta_) || null;
      const contactPerson = str(r.contact_person) || name;
      const address = str(r.address) || null;

      const existing = queryOne('SELECT id FROM buyers WHERE phone = ?', [phone]);
      if (existing) {
        run(`
          UPDATE buyers SET name = ?, name_ta = ?, contact_person = ?, market_city = ?, address = ?,
                 credit_limit = ?, billing_cycle_days = ?, updated_at = ?
          WHERE id = ?
        `, [name, nameTa, contactPerson, city, address, creditLimit, cycle, now, existing.id]);
        updatedCount++;
      } else {
        const buyerId = nextId('buyers', 'BUY-');
        run(`
          INSERT INTO buyers (
            id, name, name_ta, contact_person, phone, market_city, address,
            credit_limit, outstanding_balance, billing_cycle_days, status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 'active', ?, ?)
        `, [buyerId, name, nameTa, contactPerson, phone, city, address, creditLimit, cycle, now, now]);
        importedCount++;
      }
    });

    logAudit(req.user.id, req.user.full_name, 'BUYERS_BULK_IMPORTED', 'buyers', null,
      `Imported ${importedCount} new wholesale buyers and updated ${updatedCount} buyers.`);
  });

  res.json({ success: true, imported: importedCount, updated: updatedCount, errors });
});

// Bulk Import Flower Distributions from CSV/Excel data
app.post('/api/import/distributions', authenticateAdmin, (req, res) => {
  let records = Array.isArray(req.body.rows) ? req.body.rows : parseCsvRows(req.body.csv);
  if (!records || records.length === 0) {
    return fail(res, 400, 'no_data', 'No valid distribution rows provided to import.');
  }

  const now = new Date().toISOString();
  const today = localDate();
  let importedCount = 0;
  const errors = [];

  transaction(() => {
    records.forEach((r, idx) => {
      const buyerId = str(r.buyer_id || r.buyer);
      const buyer = queryOne('SELECT id, name FROM buyers WHERE id = ? OR name = ?', [buyerId, buyerId]);
      if (!buyer) {
        errors.push(`Row ${idx + 1}: Buyer "${buyerId}" not found in directory.`);
        return;
      }

      const location = str(r.procurement_location || r.origin || r.procurement_origin) || 'Thovalai';
      const flower = str(r.flower_type || r.flower) || 'Jasmine';
      const quantity = num(r.quantity_kg || r.weight || r.kg);
      const rate = num(r.rate_per_kg || r.rate || r.price);
      if (isNaN(quantity) || quantity <= 0 || isNaN(rate) || rate <= 0) {
        errors.push(`Row ${idx + 1}: Valid quantity and rate are required.`);
        return;
      }

      const distDate = isDateStr(r.distribution_date || r.date) ? str(r.distribution_date || r.date) : today;
      const total = round2(quantity * rate);
      const coolie = Math.max(0, num(r.coolie_charges || r.coolie) || 0);
      const transport = Math.max(0, num(r.transport_charges || r.transport) || 0);
      const vehicle = str(r.vehicle_number || r.vehicle) || null;
      const year = distDate.slice(0, 4);

      const distId = nextId('buyer_distributions', `DIST-${year}-`);
      run(`
        INSERT INTO buyer_distributions (
          id, distribution_date, buyer_id, buyer_name, procurement_location, flower_type, variety,
          quantity_kg, rate_per_kg, total_amount, coolie_charges, transport_charges,
          dispatch_status, bill_status, vehicle_number, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'delivered', 'unbilled', ?, ?, ?)
      `, [
        distId, distDate, buyer.id, buyer.name, location, flower, str(r.variety) || 'Grade A',
        round2(quantity), round2(rate), total, coolie, transport, vehicle, now, now
      ]);

      const netDue = round2(total + coolie + transport);
      run('UPDATE buyers SET outstanding_balance = outstanding_balance + ?, updated_at = ? WHERE id = ?', [netDue, now, buyer.id]);
      importedCount++;
    });

    logAudit(req.user.id, req.user.full_name, 'DISTRIBUTIONS_BULK_IMPORTED', 'buyer_distributions', null,
      `Imported ${importedCount} flower distributions to buyers.`);
  });

  res.json({ success: true, imported: importedCount, errors });
});

// Bulk Import Flower Purchases / Collections from CSV/Excel data
app.post('/api/import/collections', authenticateAdmin, (req, res) => {
  let records = Array.isArray(req.body.rows) ? req.body.rows : parseCsvRows(req.body.csv);
  if (!records || records.length === 0) {
    return fail(res, 400, 'no_data', 'No valid flower collection rows provided to import.');
  }

  const now = new Date().toISOString();
  const today = localDate();
  let importedCount = 0;
  const errors = [];

  transaction(() => {
    records.forEach((r, idx) => {
      const farmerId = str(r.farmer_id || r.farmer);
      const farmer = queryOne('SELECT id, full_name, village, commission_rate FROM farmers WHERE id = ? OR full_name = ?', [farmerId, farmerId]);
      if (!farmer) {
        errors.push(`Row ${idx + 1}: Farmer "${farmerId}" not found.`);
        return;
      }

      const flower = str(r.flower_type || r.flower) || 'Jasmine';
      const quantity = num(r.quantity_kg || r.weight || r.kg);
      const rate = num(r.rate_per_kg || r.rate || r.price);
      if (isNaN(quantity) || quantity <= 0 || isNaN(rate) || rate <= 0) {
        errors.push(`Row ${idx + 1}: Valid quantity and rate are required.`);
        return;
      }

      const colDate = isDateStr(r.collection_date || r.date) ? str(r.collection_date || r.date) : today;
      const totalAmount = round2(quantity * rate);
      const commRate = !isNaN(Number(r.commission_rate || r.commission)) ? Number(r.commission_rate || r.commission) : (farmer.commission_rate || 10.0);
      const commAmount = round2(totalAmount * (commRate / 100));
      const charges = Math.max(0, num(r.applicable_charges || r.charges) || 0);
      const netAmount = round2(totalAmount + charges);
      const year = colDate.slice(0, 4);

      const billId = nextId('collections', `COL-${year}-`);
      run(`
        INSERT INTO collections (
          id, farmer_id, farmer_name, farmer_village, collection_date, flower_type, variety,
          quantity_kg, rate_per_kg, total_amount, gross_amount, commission_rate, commission_amount,
          applicable_charges, net_amount, quality_grade, payment_status, payment_mode, amount_paid,
          status, collected_by, version, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Grade A', 'Pending', 'Cash', 0, 'completed', ?, 1, ?, ?)
      `, [
        billId, farmer.id, farmer.full_name, farmer.village, colDate, flower, str(r.variety) || 'Standard',
        round2(quantity), round2(rate), totalAmount, totalAmount, commRate, commAmount,
        charges, netAmount, req.user.full_name, now, now
      ]);

      recomputeFarmerTotals(farmer.id);
      importedCount++;
    });

    logAudit(req.user.id, req.user.full_name, 'COLLECTIONS_BULK_IMPORTED', 'collections', null,
      `Imported ${importedCount} flower harvest collections.`);
  });

  res.json({ success: true, imported: importedCount, errors });
});

// 404 for unknown API routes
app.use('/api', (req, res) => {
  fail(res, 404, 'not_found', 'API endpoint not found.');
});

// Fallback to index.html for SPA routes
app.use((req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start Database & Server when executed directly
if (require.main === module) {
  ensureDbReady().then(() => {
    app.listen(PORT, () => {
      console.log(`🌸 Fresh Blooms Flower Billing & Farmer Management System running at http://localhost:${PORT}`);
    });
  }).catch(err => {
    console.error('[Fatal Error] Database failed to initialize:', err);
    process.exit(1);
  });
}

module.exports = app;
