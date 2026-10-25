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
        next_location_review_due_at, status, total_collected_kg, total_payout, notes, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', 0, 0, ?, 1, ?, ?)
    `, [
      farmerId, fullName, nameTa || null, contact, village, villageTa || null, address || null,
      district, state, coords.lat, coords.lng, locSource, locStatus,
      coords.lat !== null ? today : null, nextDue, notes || null, now, now
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
      `Farmer ${fullName} registered with contact ${contact}`, null, farmerRecord);
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
          address = ?, district = ?, state = ?, status = ?, notes = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `, [fullName, nameTa || null, contact, village, villageTa || null, address || null, district, state, status, notes || null, now, farmer.id]);

    logAudit(req.user.id, req.user.full_name, 'FARMER_UPDATED', 'farmers', farmer.id,
      `Farmer ${fullName} (${farmer.id}) updated`, farmer, req.body);
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
  const farmers = query(`
    SELECT id, full_name, name_ta, contact_number, village, district,
           latitude, longitude, location_review_status, last_location_reviewed_at, next_location_review_due_at
    FROM farmers
    WHERE latitude IS NOT NULL AND longitude IS NOT NULL AND status = 'active'
  `);
  res.json({ farmers });
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

  const farmer = queryOne('SELECT id, full_name, village FROM farmers WHERE id = ?', [farmerId]);
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
  const netAmount = round2(totalAmount + charges);
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
        quantity_kg, rate_per_kg, total_amount, applicable_charges, net_amount,
        quality_grade, payment_status, payment_mode, amount_paid, status,
        notes, collected_by, client_ref, version, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, 1, ?, ?)
    `, [
      billId, farmer.id, farmer.full_name, farmer.village, collectionDate, flowerType, variety || null,
      round2(quantity), round2(rate), totalAmount, charges, netAmount,
      qualityGrade, paymentStatus, paymentMode, amountPaid,
      notes || null, req.user.full_name, clientRef || null, now, now
    ]);

    recomputeFarmerTotals(farmer.id);
    collectionRecord = queryOne('SELECT * FROM collections WHERE id = ?', [billId]);

    logAudit(req.user.id, req.user.full_name, 'COLLECTION_RECORDED', 'collections', billId,
      `Recorded purchase ${billId} for ${farmer.full_name}: ${quantity}kg ${flowerType} @ ₹${rate} = ₹${totalAmount}`,
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
  const netAmount = round2(totalAmount + charges);
  const paymentStatus = str(req.body.payment_status) || collection.payment_status;
  const paymentMode = str(req.body.payment_mode) || collection.payment_mode;
  const amountPaid = req.body.amount_paid !== undefined ? Math.max(0, num(req.body.amount_paid) || 0) : collection.amount_paid;
  const notes = req.body.notes !== undefined ? str(req.body.notes, 500) : collection.notes;

  const now = new Date().toISOString();
  transaction(() => {
    run(`
      UPDATE collections
      SET flower_type = ?, quantity_kg = ?, rate_per_kg = ?, total_amount = ?, applicable_charges = ?, net_amount = ?,
          payment_status = ?, payment_mode = ?, amount_paid = ?, notes = ?, version = version + 1, updated_at = ?
      WHERE id = ?
    `, [flowerType, round2(quantity), round2(rate), totalAmount, charges, netAmount,
        paymentStatus, paymentMode, amountPaid, notes, now, collection.id]);

    recomputeFarmerTotals(collection.farmer_id);

    logAudit(req.user.id, req.user.full_name, 'COLLECTION_UPDATED', 'collections', collection.id,
      `Updated bill ${collection.id}: ${quantity}kg @ ₹${rate} = ₹${totalAmount}`, collection, req.body);
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
