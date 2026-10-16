const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const {
  initDatabase,
  run,
  query,
  queryOne,
  transaction,
  logAudit,
  run15DayLocationReviewScheduler
} = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'super_secure_admin_jwt_secret_key_2026';

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Ensure Database is initialized before handling any requests (essential for Vercel Serverless)
let dbReadyPromise = null;
function ensureDbReady() {
  if (!dbReadyPromise) {
    dbReadyPromise = initDatabase().catch(err => {
      console.error('[Fatal Error] Database failed to initialize:', err);
      dbReadyPromise = null;
      throw err;
    });
  }
  return dbReadyPromise;
}

app.use(async (req, res, next) => {
  // Skip DB check for simple static files if already handled by express.static
  if (!req.path.startsWith('/api')) {
    return next();
  }
  try {
    await ensureDbReady();
    next();
  } catch (err) {
    res.status(500).json({ error: 'Database service unavailable', details: err.message });
  }
});

// In-Memory Login Rate Limiter (Brute-force protection)
const loginAttempts = new Map();
const RATE_LIMIT_WINDOW = parseInt(process.env.RATE_LIMIT_WINDOW_MS || '900000', 10); // 15 mins
const MAX_ATTEMPTS = parseInt(process.env.RATE_LIMIT_MAX_ATTEMPTS || '5', 10);

function rateLimitCheck(key) {
  const now = Date.now();
  const record = loginAttempts.get(key);
  if (!record) return { allowed: true };

  // Expired window cleanup
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

function clearFailedAttempts(key) {
  loginAttempts.delete(key);
}

// Authentication Middleware (Admin Role Only)
function authenticateAdmin(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: Authentication token is required.' });
  }

  const token = authHeader.substring(7);
  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const user = queryOne('SELECT id, username, email, full_name, role, status FROM users WHERE id = ?', [decoded.id]);

    if (!user) {
      return res.status(401).json({ error: 'User account not found.' });
    }
    if (user.status !== 'active') {
      return res.status(403).json({ error: 'Your admin account has been deactivated.' });
    }
    if (user.role !== 'admin') {
      return res.status(403).json({ error: 'Access forbidden: Administrator access required.' });
    }

    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Your session has expired. Please log in again.' });
    }
    return res.status(401).json({ error: 'Invalid authentication token.' });
  }
}

// =========================================================
// 1. AUTHENTICATION ROUTES
// =========================================================

// Admin Login
app.post('/api/auth/login', (req, res) => {
  const { username, password } = req.body;
  const ip = req.ip || req.socket.remoteAddress;

  if (!username || !password) {
    return res.status(400).json({ error: 'Username/email and password are required.' });
  }

  const clientKey = `${ip}_${username.toLowerCase().trim()}`;
  const rateLimit = rateLimitCheck(clientKey);
  if (!rateLimit.allowed) {
    logAudit('GUEST', username, 'LOGIN_BLOCKED', 'auth', null, `Rate limit triggered from IP ${ip}`, null, null, ip);
    return res.status(429).json({
      error: `Too many failed attempts. Account login locked for security. Please try again in ${rateLimit.remainingSecs} seconds.`
    });
  }

  const sanitized = username.trim();
  const user = queryOne(
    'SELECT * FROM users WHERE (username = ? OR email = ?) AND role = "admin"',
    [sanitized, sanitized]
  );

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordFailedAttempt(clientKey);
    logAudit('GUEST', sanitized, 'LOGIN_FAILED', 'auth', null, `Invalid credentials for ${sanitized}`, null, null, ip);
    return res.status(401).json({ error: 'Invalid administrator credentials.' });
  }

  if (user.status !== 'active') {
    return res.status(403).json({ error: 'This administrator account is currently suspended.' });
  }

  // Clear rate limits on successful auth
  clearFailedAttempts(clientKey);

  const now = new Date().toISOString();
  run('UPDATE users SET last_login_at = ? WHERE id = ?', [now, user.id]);

  const token = jwt.sign(
    { id: user.id, username: user.username, role: user.role },
    JWT_SECRET,
    { expiresIn: '8h' }
  );

  logAudit(user.id, user.full_name, 'LOGIN_SUCCESS', 'auth', String(user.id), `Admin login from IP ${ip}`, null, null, ip);

  res.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      full_name: user.full_name,
      role: user.role,
      last_login_at: user.last_login_at
    }
  });
});

// Admin Profile Verification
app.get('/api/auth/me', authenticateAdmin, (req, res) => {
  res.json({
    user: req.user,
    serverTime: new Date().toISOString()
  });
});

// Change Password
app.post('/api/auth/change-password', authenticateAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Both current password and new password are required.' });
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters long.' });
  }

  const user = queryOne('SELECT * FROM users WHERE id = ?', [req.user.id]);
  if (!user || !bcrypt.compareSync(currentPassword, user.password_hash)) {
    return res.status(400).json({ error: 'Current password verification failed.' });
  }

  const newHash = bcrypt.hashSync(newPassword, 12);
  const now = new Date().toISOString();

  run('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?', [newHash, now, req.user.id]);
  logAudit(req.user.id, req.user.full_name, 'PASSWORD_CHANGED', 'users', String(req.user.id), 'Administrator password updated');

  res.json({ success: true, message: 'Password changed successfully.' });
});

// Admin Logout
app.post('/api/auth/logout', authenticateAdmin, (req, res) => {
  logAudit(req.user.id, req.user.full_name, 'LOGOUT', 'auth', String(req.user.id), 'Administrator logged out');
  res.json({ success: true, message: 'Logged out successfully.' });
});

// =========================================================
// 2. DASHBOARD (REAL DATABASE METRICS ONLY - ZERO SYNTHETIC DATA)
// =========================================================
app.get('/api/dashboard/stats', authenticateAdmin, (req, res) => {
  // Run review check so review statuses are up to date
  run15DayLocationReviewScheduler();

  const farmerCount = queryOne('SELECT COUNT(*) as count FROM farmers');
  const activeFarmerCount = queryOne('SELECT COUNT(*) as count FROM farmers WHERE status = "active"');
  const collectionsCount = queryOne('SELECT COUNT(*) as count FROM collections WHERE status = "completed"');

  const totals = queryOne(`
    SELECT
      COALESCE(SUM(quantity_kg), 0) as total_kg,
      COALESCE(SUM(total_amount), 0) as total_payout,
      COALESCE(SUM(CASE WHEN payment_status = 'Pending' THEN total_amount - amount_paid ELSE 0 END), 0) as pending_payout
    FROM collections
    WHERE status = "completed"
  `);

  // 15-day location review breakdown
  const locationStats = queryOne(`
    SELECT
      COUNT(CASE WHEN location_review_status = 'verified' THEN 1 END) as verified_count,
      COUNT(CASE WHEN location_review_status = 'due_soon' THEN 1 END) as due_soon_count,
      COUNT(CASE WHEN location_review_status = 'overdue' THEN 1 END) as overdue_count,
      COUNT(CASE WHEN location_review_status = 'unavailable' THEN 1 END) as unavailable_count
    FROM farmers
    WHERE status = 'active'
  `);

  // Recent 5 Collections (real)
  const recentCollections = query(`
    SELECT id, farmer_id, farmer_name, farmer_village, collection_date, flower_type, quantity_kg, rate_per_kg, total_amount, payment_status, quality_grade
    FROM collections
    ORDER BY created_at DESC
    LIMIT 5
  `);

  // Recent 5 Audit Events
  const recentAuditLogs = query(`
    SELECT timestamp, actor_name, action, entity_type, entity_id, details
    FROM audit_logs
    ORDER BY timestamp DESC
    LIMIT 6
  `);

  // Real flower breakdown from actual collections
  const flowerBreakdown = query(`
    SELECT flower_type, SUM(quantity_kg) as total_kg, SUM(total_amount) as total_amount, COUNT(id) as record_count
    FROM collections
    WHERE status = 'completed'
    GROUP BY flower_type
    ORDER BY total_kg DESC
    LIMIT 6
  `);

  // Real village breakdown
  const villageBreakdown = query(`
    SELECT village, COUNT(id) as farmer_count, SUM(total_collected_kg) as total_kg
    FROM farmers
    GROUP BY village
    ORDER BY total_kg DESC
    LIMIT 5
  `);

  res.json({
    totalFarmers: farmerCount?.count || 0,
    activeFarmers: activeFarmerCount?.count || 0,
    totalCollections: collectionsCount?.count || 0,
    totalQuantityKg: parseFloat((totals?.total_kg || 0).toFixed(2)),
    totalPayout: Math.round(totals?.total_payout || 0),
    pendingPayout: Math.round(totals?.pending_payout || 0),
    locationStats: {
      verified: locationStats?.verified_count || 0,
      dueSoon: locationStats?.due_soon_count || 0,
      overdue: locationStats?.overdue_count || 0,
      unavailable: locationStats?.unavailable_count || 0,
      totalDueOrOverdue: (locationStats?.due_soon_count || 0) + (locationStats?.overdue_count || 0)
    },
    recentCollections,
    recentAuditLogs,
    flowerBreakdown,
    villageBreakdown,
    lastSyncedAt: new Date().toISOString()
  });
});

// =========================================================
// 3. FARMER MANAGEMENT
// =========================================================

// List Farmers with search, filter, pagination
app.get('/api/farmers', authenticateAdmin, (req, res) => {
  const { search, village, status, reviewStatus, page = 1, limit = 20 } = req.query;

  let whereClauses = [];
  let params = [];

  if (search && search.trim()) {
    const s = `%${search.trim()}%`;
    whereClauses.push('(id LIKE ? OR full_name LIKE ? OR contact_number LIKE ? OR village LIKE ?)');
    params.push(s, s, s, s);
  }

  if (village && village.trim()) {
    whereClauses.push('village = ?');
    params.push(village.trim());
  }

  if (status && status.trim()) {
    whereClauses.push('status = ?');
    params.push(status.trim());
  }

  if (reviewStatus && reviewStatus.trim()) {
    whereClauses.push('location_review_status = ?');
    params.push(reviewStatus.trim());
  }

  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(' AND ')}` : '';

  const totalRow = queryOne(`SELECT COUNT(*) as count FROM farmers ${whereSql}`, params);
  const total = totalRow?.count || 0;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const farmers = query(`
    SELECT * FROM farmers
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limitNum, offset]);

  // Distinct villages for filtering
  const villages = query('SELECT DISTINCT village FROM farmers WHERE village IS NOT NULL ORDER BY village ASC');

  res.json({
    farmers,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1
    },
    villages: villages.map(v => v.village)
  });
});

// Register New Farmer
app.post('/api/farmers', authenticateAdmin, (req, res) => {
  const {
    full_name,
    contact_number,
    address,
    village,
    latitude,
    longitude,
    notes
  } = req.body;

  if (!full_name || !full_name.trim()) {
    return res.status(400).json({ error: 'Farmer full name is required.' });
  }
  if (!contact_number || !contact_number.trim()) {
    return res.status(400).json({ error: 'Contact phone number is required.' });
  }
  if (!village || !village.trim()) {
    return res.status(400).json({ error: 'Village or locality is required.' });
  }

  const cleanContact = contact_number.trim();
  const existing = queryOne('SELECT id FROM farmers WHERE contact_number = ?', [cleanContact]);
  if (existing) {
    return res.status(409).json({ error: `A farmer with contact number ${cleanContact} is already registered (${existing.id}).` });
  }

  // Parse GPS coordinates if available
  let latNum = latitude !== undefined && latitude !== null && latitude !== '' ? parseFloat(latitude) : null;
  let lngNum = longitude !== undefined && longitude !== null && longitude !== '' ? parseFloat(longitude) : null;

  if (latNum !== null && (isNaN(latNum) || latNum < -90 || latNum > 90)) {
    return res.status(400).json({ error: 'Invalid latitude. Must be between -90 and 90.' });
  }
  if (lngNum !== null && (isNaN(lngNum) || lngNum < -180 || lngNum > 180)) {
    return res.status(400).json({ error: 'Invalid longitude. Must be between -180 and 180.' });
  }

  // Generate unique Farmer ID: FAR-1001, FAR-1002...
  const lastFarmer = queryOne('SELECT id FROM farmers ORDER BY id DESC LIMIT 1');
  let nextNum = 1001;
  if (lastFarmer && lastFarmer.id && lastFarmer.id.startsWith('FAR-')) {
    const numPart = parseInt(lastFarmer.id.replace('FAR-', ''), 10);
    if (!isNaN(numPart)) nextNum = numPart + 1;
  }
  const farmerId = `FAR-${nextNum}`;

  const now = new Date();
  const nowIso = now.toISOString();

  let reviewStatus = 'unavailable';
  let nextReviewDue = null;
  let lastReviewAt = null;

  if (latNum !== null && lngNum !== null) {
    reviewStatus = 'verified';
    lastReviewAt = nowIso.slice(0, 10);
    const dueDate = new Date(now);
    dueDate.setDate(dueDate.getDate() + 15);
    nextReviewDue = dueDate.toISOString().slice(0, 10);
  }

  transaction(() => {
    run(`
      INSERT INTO farmers (
        id, full_name, contact_number, address, village,
        latitude, longitude, status, notes,
        total_collected_kg, total_payout, last_collection_date,
        last_location_reviewed_at, next_location_review_due_at, location_review_status,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, 0, 0, null, ?, ?, ?, ?, ?)
    `, [
      farmerId,
      full_name.trim(),
      cleanContact,
      address ? address.trim() : '',
      village.trim(),
      latNum,
      lngNum,
      notes ? notes.trim() : '',
      lastReviewAt,
      nextReviewDue,
      reviewStatus,
      nowIso,
      nowIso
    ]);

    // If coordinates were captured, write initial audit location entry
    if (latNum !== null && lngNum !== null) {
      run(`
        INSERT INTO farmer_locations (
          farmer_id, latitude, longitude, village, address, source, verification_status, verified_by, capture_timestamp, review_notes, created_at
        ) VALUES (?, ?, ?, ?, ?, 'Admin Verified Registration', 'verified', ?, ?, 'Initial farmer registration coordinates verified', ?)
      `, [
        farmerId,
        latNum,
        lngNum,
        village.trim(),
        address ? address.trim() : '',
        req.user.full_name,
        nowIso,
        nowIso
      ]);
    }

    logAudit(
      req.user.id,
      req.user.full_name,
      'FARMER_REGISTERED',
      'farmers',
      farmerId,
      `Registered farmer ${full_name} (${farmerId}) from village ${village}`,
      null,
      { id: farmerId, full_name, contact_number: cleanContact, village, latitude: latNum, longitude: lngNum }
    );
  });

  const created = queryOne('SELECT * FROM farmers WHERE id = ?', [farmerId]);
  res.status(201).json(created);
});

// Get Single Farmer Profile with Collections, 15-day Location History, and Audit Trail
app.get('/api/farmers/:id', authenticateAdmin, (req, res) => {
  const farmer = queryOne('SELECT * FROM farmers WHERE id = ?', [req.params.id]);
  if (!farmer) {
    return res.status(404).json({ error: 'Farmer record not found.' });
  }

  // All collections from this farmer
  const collections = query(`
    SELECT * FROM collections
    WHERE farmer_id = ?
    ORDER BY collection_date DESC, created_at DESC
  `, [farmer.id]);

  // 15-Day Location Review History
  const locationHistory = query(`
    SELECT * FROM farmer_locations
    WHERE farmer_id = ?
    ORDER BY capture_timestamp DESC
  `, [farmer.id]);

  // Farmer Audit Events
  const auditTrail = query(`
    SELECT * FROM audit_logs
    WHERE entity_type = 'farmers' AND entity_id = ?
    ORDER BY timestamp DESC
  `, [farmer.id]);

  res.json({
    ...farmer,
    collections,
    locationHistory,
    auditTrail
  });
});

// Update Farmer Details
app.put('/api/farmers/:id', authenticateAdmin, (req, res) => {
  const farmer = queryOne('SELECT * FROM farmers WHERE id = ?', [req.params.id]);
  if (!farmer) {
    return res.status(404).json({ error: 'Farmer not found.' });
  }

  const { full_name, contact_number, address, village, notes, status } = req.body;

  if (contact_number && contact_number.trim() !== farmer.contact_number) {
    const existing = queryOne('SELECT id FROM farmers WHERE contact_number = ? AND id != ?', [contact_number.trim(), farmer.id]);
    if (existing) {
      return res.status(409).json({ error: 'Another farmer is already registered with this contact number.' });
    }
  }

  const now = new Date().toISOString();
  const updatedName = full_name !== undefined ? full_name.trim() : farmer.full_name;
  const updatedContact = contact_number !== undefined ? contact_number.trim() : farmer.contact_number;
  const updatedAddress = address !== undefined ? address.trim() : farmer.address;
  const updatedVillage = village !== undefined ? village.trim() : farmer.village;
  const updatedNotes = notes !== undefined ? notes.trim() : farmer.notes;
  const updatedStatus = status !== undefined ? status.trim() : farmer.status;

  run(`
    UPDATE farmers
    SET full_name = ?, contact_number = ?, address = ?, village = ?, notes = ?, status = ?, updated_at = ?
    WHERE id = ?
  `, [updatedName, updatedContact, updatedAddress, updatedVillage, updatedNotes, updatedStatus, now, farmer.id]);

  logAudit(
    req.user.id,
    req.user.full_name,
    'FARMER_UPDATED',
    'farmers',
    farmer.id,
    `Updated profile for farmer ${farmer.full_name} (${farmer.id})`,
    farmer,
    { full_name: updatedName, contact_number: updatedContact, village: updatedVillage, status: updatedStatus }
  );

  const updated = queryOne('SELECT * FROM farmers WHERE id = ?', [farmer.id]);
  res.json(updated);
});

// =========================================================
// 4. 15-DAY FARMER LOCATION REVIEWS & MAP
// =========================================================

// Submit/Review Farmer Location (15-Day Cycle Action)
app.post('/api/farmers/:id/location', authenticateAdmin, (req, res) => {
  const farmer = queryOne('SELECT * FROM farmers WHERE id = ?', [req.params.id]);
  if (!farmer) {
    return res.status(404).json({ error: 'Farmer record not found.' });
  }

  const { latitude, longitude, village, address, source, review_notes } = req.body;

  const latNum = parseFloat(latitude);
  const lngNum = parseFloat(longitude);

  if (isNaN(latNum) || latNum < -90 || latNum > 90 || isNaN(lngNum) || lngNum < -180 || lngNum > 180) {
    return res.status(400).json({ error: 'Valid latitude (-90 to 90) and longitude (-180 to 180) are required.' });
  }

  const now = new Date();
  const nowIso = now.toISOString();

  // Next review due in 15 days
  const dueDate = new Date(now);
  dueDate.setDate(dueDate.getDate() + 15);
  const nextReviewDue = dueDate.toISOString().slice(0, 10);

  const locSource = source || 'Admin Verified Update';

  transaction(() => {
    // 1. Update farmer table
    run(`
      UPDATE farmers
      SET latitude = ?, longitude = ?,
          village = COALESCE(?, village),
          address = COALESCE(?, address),
          last_location_reviewed_at = ?,
          next_location_review_due_at = ?,
          location_review_status = 'verified',
          updated_at = ?
      WHERE id = ?
    `, [
      latNum,
      lngNum,
      village ? village.trim() : null,
      address ? address.trim() : null,
      nowIso.slice(0, 10),
      nextReviewDue,
      nowIso,
      farmer.id
    ]);

    // 2. Append to location history (Preserving all previous records!)
    run(`
      INSERT INTO farmer_locations (
        farmer_id, latitude, longitude, village, address,
        source, verification_status, verified_by, capture_timestamp, review_notes, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, 'verified', ?, ?, ?, ?)
    `, [
      farmer.id,
      latNum,
      lngNum,
      village ? village.trim() : farmer.village,
      address ? address.trim() : farmer.address,
      locSource,
      req.user.full_name,
      nowIso,
      review_notes ? review_notes.trim() : '15-day location review confirmed by administrator',
      nowIso
    ]);

    // 3. Log audit event
    logAudit(
      req.user.id,
      req.user.full_name,
      'FARMER_LOCATION_REVIEWED',
      'farmers',
      farmer.id,
      `15-day location review completed for ${farmer.full_name}. Verified GPS: [${latNum.toFixed(5)}, ${lngNum.toFixed(5)}]. Next due: ${nextReviewDue}`,
      { latitude: farmer.latitude, longitude: farmer.longitude, status: farmer.location_review_status },
      { latitude: latNum, longitude: lngNum, status: 'verified', next_review: nextReviewDue }
    );
  });

  const updatedFarmer = queryOne('SELECT * FROM farmers WHERE id = ?', [farmer.id]);
  res.json({
    success: true,
    message: 'Farmer location verified and 15-day review cycle updated successfully.',
    farmer: updatedFarmer
  });
});

// Map View Data: All farmers with verified GPS coordinates
app.get('/api/farmers/locations/map', authenticateAdmin, (req, res) => {
  const { village, status, reviewStatus } = req.query;

  let where = ['latitude IS NOT NULL', 'longitude IS NOT NULL'];
  let params = [];

  if (village && village.trim()) {
    where.push('village = ?');
    params.push(village.trim());
  }
  if (status && status.trim()) {
    where.push('status = ?');
    params.push(status.trim());
  }
  if (reviewStatus && reviewStatus.trim()) {
    where.push('location_review_status = ?');
    params.push(reviewStatus.trim());
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const mappedFarmers = query(`
    SELECT
      id, full_name, contact_number, village, address,
      latitude, longitude, status,
      total_collected_kg, total_payout, last_collection_date,
      last_location_reviewed_at, next_location_review_due_at, location_review_status
    FROM farmers
    ${whereSql}
    ORDER BY full_name ASC
  `, params);

  res.json({
    count: mappedFarmers.length,
    farmers: mappedFarmers
  });
});

// Trigger 15-Day Location Review Scheduler Manually
app.post('/api/farmers/locations/run-review', authenticateAdmin, (req, res) => {
  run15DayLocationReviewScheduler();
  logAudit(req.user.id, req.user.full_name, 'LOCATION_SCHEDULER_EXECUTED', 'system', null, '15-Day location review cycle evaluated');
  res.json({ success: true, message: '15-day location review statuses updated successfully.' });
});

// =========================================================
// 5. COLLECTION MANAGEMENT (HARVEST LOGGING)
// =========================================================

// List Collections with search & filters
app.get('/api/collections', authenticateAdmin, (req, res) => {
  const { farmer_id, flower_type, payment_status, startDate, endDate, page = 1, limit = 25 } = req.query;

  let where = [];
  let params = [];

  if (farmer_id && farmer_id.trim()) {
    where.push('(farmer_id = ? OR farmer_name LIKE ?)');
    params.push(farmer_id.trim(), `%${farmer_id.trim()}%`);
  }
  if (flower_type && flower_type.trim()) {
    where.push('flower_type = ?');
    params.push(flower_type.trim());
  }
  if (payment_status && payment_status.trim()) {
    where.push('payment_status = ?');
    params.push(payment_status.trim());
  }
  if (startDate && startDate.trim()) {
    where.push('collection_date >= ?');
    params.push(startDate.trim());
  }
  if (endDate && endDate.trim()) {
    where.push('collection_date <= ?');
    params.push(endDate.trim());
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = queryOne(`SELECT COUNT(*) as count FROM collections ${whereSql}`, params);
  const total = totalRow?.count || 0;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const collections = query(`
    SELECT * FROM collections
    ${whereSql}
    ORDER BY collection_date DESC, created_at DESC
    LIMIT ? OFFSET ?
  `, [...params, limitNum, offset]);

  res.json({
    collections,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1
    }
  });
});

// Record New Harvest Collection from Farmer
app.post('/api/collections', authenticateAdmin, (req, res) => {
  const {
    farmer_id,
    collection_date,
    flower_type,
    variety,
    quantity_kg,
    rate_per_kg,
    quality_grade,
    payment_status,
    payment_mode,
    notes,
    capture_gps_latitude,
    capture_gps_longitude
  } = req.body;

  if (!farmer_id) {
    return res.status(400).json({ error: 'Farmer selection is required.' });
  }
  const farmer = queryOne('SELECT * FROM farmers WHERE id = ?', [farmer_id]);
  if (!farmer) {
    return res.status(404).json({ error: 'Selected farmer does not exist.' });
  }
  if (farmer.status !== 'active') {
    return res.status(400).json({ error: 'Cannot record collections for inactive or archived farmer.' });
  }

  const qty = parseFloat(quantity_kg);
  const rate = parseFloat(rate_per_kg);

  if (isNaN(qty) || qty <= 0) {
    return res.status(400).json({ error: 'Valid positive flower quantity (kg) is required.' });
  }
  if (isNaN(rate) || rate < 0) {
    return res.status(400).json({ error: 'Valid rate per kg is required.' });
  }

  const totalAmount = Math.round(qty * rate * 100) / 100;
  const payStatus = payment_status || 'Pending';
  const payMode = payment_mode || 'Cash';
  const amountPaid = payStatus === 'Paid' ? totalAmount : 0;
  const collDate = collection_date ? collection_date.slice(0, 10) : new Date().toISOString().slice(0, 10);

  // Generate Collection ID: COL-2026-1001
  const year = new Date().getFullYear();
  const lastCol = queryOne('SELECT id FROM collections ORDER BY id DESC LIMIT 1');
  let nextNum = 1001;
  if (lastCol && lastCol.id && lastCol.id.startsWith(`COL-${year}-`)) {
    const num = parseInt(lastCol.id.replace(`COL-${year}-`, ''), 10);
    if (!isNaN(num)) nextNum = num + 1;
  }
  const collectionId = `COL-${year}-${nextNum}`;
  const nowIso = new Date().toISOString();

  transaction(() => {
    // 1. Insert collection record
    run(`
      INSERT INTO collections (
        id, farmer_id, farmer_name, farmer_village, collection_date,
        flower_type, variety, quantity_kg, rate_per_kg, total_amount,
        quality_grade, payment_status, payment_mode, amount_paid,
        status, notes, collected_by, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'completed', ?, ?, ?, ?)
    `, [
      collectionId,
      farmer.id,
      farmer.full_name,
      farmer.village,
      collDate,
      flower_type.trim(),
      variety ? variety.trim() : 'Local',
      qty,
      rate,
      totalAmount,
      quality_grade || 'Grade A',
      payStatus,
      payMode,
      amountPaid,
      notes ? notes.trim() : '',
      req.user.full_name,
      nowIso,
      nowIso
    ]);

    // 2. Update farmer cumulative statistics
    const newTotalKg = parseFloat((farmer.total_collected_kg + qty).toFixed(2));
    const newTotalPayout = farmer.total_payout + totalAmount;

    run(`
      UPDATE farmers
      SET total_collected_kg = ?, total_payout = ?, last_collection_date = ?, updated_at = ?
      WHERE id = ?
    `, [newTotalKg, newTotalPayout, collDate, nowIso, farmer.id]);

    // 3. Optional: If field GPS coordinates provided during collection, register location verification
    if (capture_gps_latitude && capture_gps_longitude) {
      const lat = parseFloat(capture_gps_latitude);
      const lng = parseFloat(capture_gps_longitude);
      if (!isNaN(lat) && !isNaN(lng)) {
        const dueDate = new Date();
        dueDate.setDate(dueDate.getDate() + 15);
        const nextDue = dueDate.toISOString().slice(0, 10);

        run(`
          INSERT INTO farmer_locations (
            farmer_id, collection_id, latitude, longitude, village, address,
            source, verification_status, verified_by, capture_timestamp, review_notes, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'Field Visit Collection', 'verified', ?, ?, ?, ?)
        `, [
          farmer.id,
          collectionId,
          lat,
          lng,
          farmer.village,
          farmer.address,
          req.user.full_name,
          nowIso,
          `Location recorded during collection ${collectionId}`,
          nowIso
        ]);

        run(`
          UPDATE farmers
          SET latitude = ?, longitude = ?,
              last_location_reviewed_at = ?,
              next_location_review_due_at = ?,
              location_review_status = 'verified'
          WHERE id = ?
        `, [lat, lng, nowIso.slice(0, 10), nextDue, farmer.id]);
      }
    }

    // 4. Log Audit Event
    logAudit(
      req.user.id,
      req.user.full_name,
      'COLLECTION_RECORDED',
      'collections',
      collectionId,
      `Recorded ${qty} kg ${flower_type} from ${farmer.full_name} (${farmer.id}) at ₹${rate}/kg. Total: ₹${totalAmount}`,
      null,
      { collectionId, farmer_id: farmer.id, quantity_kg: qty, total_amount: totalAmount, payment_status: payStatus }
    );
  });

  const createdCollection = queryOne('SELECT * FROM collections WHERE id = ?', [collectionId]);
  res.status(201).json(createdCollection);
});

// Cancel / Reverse a Collection with mandatory audit reason
app.post('/api/collections/:id/cancel', authenticateAdmin, (req, res) => {
  const { reason } = req.body;
  if (!reason || !reason.trim()) {
    return res.status(400).json({ error: 'A valid reason is required to cancel or reverse a collection.' });
  }

  const collection = queryOne('SELECT * FROM collections WHERE id = ?', [req.params.id]);
  if (!collection) {
    return res.status(404).json({ error: 'Collection record not found.' });
  }
  if (collection.status === 'cancelled') {
    return res.status(400).json({ error: 'This collection is already cancelled.' });
  }

  const farmer = queryOne('SELECT * FROM farmers WHERE id = ?', [collection.farmer_id]);
  const now = new Date().toISOString();

  transaction(() => {
    // 1. Mark collection cancelled
    run(`
      UPDATE collections
      SET status = 'cancelled', cancellation_reason = ?, updated_at = ?
      WHERE id = ?
    `, [reason.trim(), now, collection.id]);

    // 2. Reverse farmer totals if farmer still exists
    if (farmer) {
      const reversedKg = Math.max(0, parseFloat((farmer.total_collected_kg - collection.quantity_kg).toFixed(2)));
      const reversedPayout = Math.max(0, farmer.total_payout - collection.total_amount);

      run(`
        UPDATE farmers
        SET total_collected_kg = ?, total_payout = ?, updated_at = ?
        WHERE id = ?
      `, [reversedKg, reversedPayout, now, farmer.id]);
    }

    // 3. Audit trail
    logAudit(
      req.user.id,
      req.user.full_name,
      'COLLECTION_CANCELLED',
      'collections',
      collection.id,
      `Cancelled collection ${collection.id} for farmer ${collection.farmer_name}. Reason: ${reason.trim()}`,
      collection,
      { status: 'cancelled', cancellation_reason: reason.trim() }
    );
  });

  res.json({ success: true, message: `Collection ${collection.id} successfully cancelled.` });
});

// Update Collection Payment Status
app.post('/api/collections/:id/payment', authenticateAdmin, (req, res) => {
  const { payment_status, payment_mode, amount_paid } = req.body;

  const collection = queryOne('SELECT * FROM collections WHERE id = ?', [req.params.id]);
  if (!collection) {
    return res.status(404).json({ error: 'Collection not found.' });
  }

  const now = new Date().toISOString();
  const paid = amount_paid !== undefined ? parseFloat(amount_paid) : collection.total_amount;

  run(`
    UPDATE collections
    SET payment_status = ?, payment_mode = ?, amount_paid = ?, updated_at = ?
    WHERE id = ?
  `, [payment_status || 'Paid', payment_mode || collection.payment_mode, paid, now, collection.id]);

  logAudit(
    req.user.id,
    req.user.full_name,
    'PAYMENT_STATUS_UPDATED',
    'collections',
    collection.id,
    `Updated payment status to ${payment_status} (₹${paid}) for collection ${collection.id}`
  );

  res.json({ success: true, message: 'Payment status updated.' });
});

// =========================================================
// 6. REPORTS & EXPORTS
// =========================================================

// Summary report
app.get('/api/reports/summary', authenticateAdmin, (req, res) => {
  const { startDate, endDate, village } = req.query;

  let where = ["status = 'completed'"];
  let params = [];

  if (startDate) {
    where.push('collection_date >= ?');
    params.push(startDate);
  }
  if (endDate) {
    where.push('collection_date <= ?');
    params.push(endDate);
  }
  if (village) {
    where.push('farmer_village = ?');
    params.push(village);
  }

  const whereSql = `WHERE ${where.join(' AND ')}`;

  const summary = queryOne(`
    SELECT
      COUNT(id) as total_collections,
      COUNT(DISTINCT farmer_id) as active_farmers,
      COALESCE(SUM(quantity_kg), 0) as total_kg,
      COALESCE(SUM(total_amount), 0) as total_payout,
      COALESCE(SUM(amount_paid), 0) as paid_amount,
      COALESCE(SUM(CASE WHEN payment_status = 'Pending' THEN total_amount - amount_paid ELSE 0 END), 0) as pending_amount
    FROM collections
    ${whereSql}
  `, params);

  const flowerBreakdown = query(`
    SELECT flower_type, SUM(quantity_kg) as total_kg, SUM(total_amount) as total_amount
    FROM collections
    ${whereSql}
    GROUP BY flower_type
    ORDER BY total_kg DESC
  `, params);

  const villageBreakdown = query(`
    SELECT farmer_village as village, COUNT(id) as collections_count, SUM(quantity_kg) as total_kg, SUM(total_amount) as total_amount
    FROM collections
    ${whereSql}
    GROUP BY farmer_village
    ORDER BY total_kg DESC
  `, params);

  res.json({
    summary: {
      totalCollections: summary?.total_collections || 0,
      activeFarmers: summary?.active_farmers || 0,
      totalKg: parseFloat((summary?.total_kg || 0).toFixed(2)),
      totalPayout: Math.round(summary?.total_payout || 0),
      paidAmount: Math.round(summary?.paid_amount || 0),
      pendingAmount: Math.round(summary?.pending_amount || 0)
    },
    flowerBreakdown,
    villageBreakdown
  });
});

// Export Collections to CSV
app.get('/api/reports/export/collections-csv', authenticateAdmin, (req, res) => {
  const collections = query('SELECT * FROM collections ORDER BY collection_date DESC');

  let csv = 'Collection ID,Farmer ID,Farmer Name,Village,Date,Flower Type,Variety,Quantity (kg),Rate (INR/kg),Total (INR),Payment Status,Payment Mode,Quality Grade,Notes\n';

  for (const c of collections) {
    csv += `"${c.id}","${c.farmer_id}","${c.farmer_name}","${c.farmer_village}","${c.collection_date}","${c.flower_type}","${c.variety || ''}",${c.quantity_kg},${c.rate_per_kg},${c.total_amount},"${c.payment_status}","${c.payment_mode}","${c.quality_grade || ''}","${(c.notes || '').replace(/"/g, '""')}"\n`;
  }

  logAudit(req.user.id, req.user.full_name, 'DATA_EXPORTED', 'collections', null, `Exported ${collections.length} collections to CSV`);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="collections_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// Export Farmers to CSV
app.get('/api/reports/export/farmers-csv', authenticateAdmin, (req, res) => {
  const farmers = query('SELECT * FROM farmers ORDER BY full_name ASC');

  let csv = 'Farmer ID,Full Name,Contact Number,Village,Address,Status,Total Collected (kg),Total Payout (INR),GPS Latitude,GPS Longitude,15-Day Location Status,Last Reviewed,Next Review Due,Registration Date\n';

  for (const f of farmers) {
    csv += `"${f.id}","${f.full_name}","${f.contact_number}","${f.village}","${(f.address || '').replace(/"/g, '""')}","${f.status}",${f.total_collected_kg},${f.total_payout},"${f.latitude || ''}","${f.longitude || ''}","${f.location_review_status}","${f.last_location_reviewed_at || ''}","${f.next_location_review_due_at || ''}","${f.created_at.slice(0, 10)}"\n`;
  }

  logAudit(req.user.id, req.user.full_name, 'DATA_EXPORTED', 'farmers', null, `Exported ${farmers.length} farmers to CSV`);

  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', `attachment; filename="farmers_${new Date().toISOString().slice(0, 10)}.csv"`);
  res.send(csv);
});

// =========================================================
// 7. AUDIT TRAIL LOGS
// =========================================================
app.get('/api/audit-logs', authenticateAdmin, (req, res) => {
  const { action, entity_type, page = 1, limit = 50 } = req.query;

  let where = [];
  let params = [];

  if (action && action.trim()) {
    where.push('action = ?');
    params.push(action.trim());
  }
  if (entity_type && entity_type.trim()) {
    where.push('entity_type = ?');
    params.push(entity_type.trim());
  }

  const whereSql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';

  const totalRow = queryOne(`SELECT COUNT(*) as count FROM audit_logs ${whereSql}`, params);
  const total = totalRow?.count || 0;

  const pageNum = Math.max(1, parseInt(page, 10));
  const limitNum = Math.max(1, Math.min(100, parseInt(limit, 10)));
  const offset = (pageNum - 1) * limitNum;

  const logs = query(`
    SELECT * FROM audit_logs
    ${whereSql}
    ORDER BY timestamp DESC
    LIMIT ? OFFSET ?
  `, [...params, limitNum, offset]);

  res.json({
    logs,
    pagination: {
      total,
      page: pageNum,
      limit: limitNum,
      totalPages: Math.ceil(total / limitNum) || 1
    }
  });
});

// =========================================================
// 8. SETTINGS & FULL DATABASE BACKUP
// =========================================================
app.get('/api/settings', authenticateAdmin, (req, res) => {
  const rows = query('SELECT key, value FROM settings');
  const result = {};
  for (const r of rows) result[r.key] = r.value;
  res.json(result);
});

app.put('/api/settings', authenticateAdmin, (req, res) => {
  const entries = Object.entries(req.body);
  const now = new Date().toISOString();

  for (const [key, val] of entries) {
    const existing = queryOne('SELECT key FROM settings WHERE key = ?', [key]);
    if (existing) {
      run('UPDATE settings SET value = ?, updated_at = ? WHERE key = ?', [String(val), now, key]);
    } else {
      run('INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)', [key, String(val), now]);
    }
  }

  logAudit(req.user.id, req.user.full_name, 'SETTINGS_UPDATED', 'settings', null, 'System settings updated');
  res.json({ success: true, message: 'Settings saved successfully.' });
});

// Full JSON Backup Export
app.get('/api/backup', authenticateAdmin, (req, res) => {
  const backup = {
    exportedAt: new Date().toISOString(),
    exportedBy: req.user.full_name,
    farmers: query('SELECT * FROM farmers'),
    farmer_locations: query('SELECT * FROM farmer_locations'),
    collections: query('SELECT * FROM collections'),
    audit_logs: query('SELECT * FROM audit_logs'),
    settings: query('SELECT * FROM settings')
  };

  logAudit(req.user.id, req.user.full_name, 'FULL_BACKUP_GENERATED', 'system', null, 'Full database JSON backup downloaded');

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="fresh_blooms_backup_${new Date().toISOString().slice(0, 10)}.json"`);
  res.json(backup);
});

// Start Database & Server when executed directly
if (require.main === module) {
  ensureDbReady().then(() => {
    app.listen(PORT, () => {
      console.log(`🌸 Fresh Blooms Admin & Farmer Collection System running at http://localhost:${PORT}`);
    });

    // Run the 15-day location review scheduler daily
    setInterval(() => {
      console.log('[Scheduler] Daily 15-day location review scan triggered.');
      run15DayLocationReviewScheduler();
    }, 24 * 60 * 60 * 1000);

  }).catch(err => {
    console.error('[Fatal Error] Database failed to initialize:', err);
    process.exit(1);
  });
}

module.exports = app;
