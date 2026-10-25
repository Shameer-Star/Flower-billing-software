const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('events');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-blooms-features-test-'));
process.env.DB_PATH = path.join(tmpDir, 'features_test.sqlite');
process.env.ADMIN_INITIAL_USERNAME = 'admin';
process.env.ADMIN_INITIAL_PASSWORD = 'Test@12345';
process.env.AUDIT_INTERVAL_DAYS = '15';

const app = require('../server');
const db = require('../db');
const dates = require('../dates');

let server;
let base;
let token;

async function api(urlPath, { method = 'GET', body, auth = true } = {}) {
  const headers = {};
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + urlPath, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;

  const loginRes = await api('/api/auth/login', {
    method: 'POST',
    body: { username: 'admin', password: 'Test@12345' },
    auth: false
  });
  token = loginRes.data.token;
});

after(() => {
  server.close();
  db.closeDatabase();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('feature: comprehensive farmer management with district, state, and versioning', async () => {
  const res = await api('/api/farmers', {
    method: 'POST',
    body: {
      full_name: 'Sundaram Pillai',
      name_ta: 'சுந்தரம் பிள்ளை',
      contact_number: '9842100001',
      village: 'Thovalai',
      village_ta: 'தோவாளை',
      address: '12 Main Bazaar',
      district: 'Kanyakumari',
      state: 'Tamil Nadu',
      latitude: 8.2435,
      longitude: 77.4982,
      notes: 'Premium Jasmine Farmer'
    }
  });

  assert.equal(res.status, 201);
  assert.equal(res.data.full_name, 'Sundaram Pillai');
  assert.equal(res.data.name_ta, 'சுந்தரம் பிள்ளை');
  assert.equal(res.data.district, 'Kanyakumari');
  assert.equal(res.data.state, 'Tamil Nadu');
  assert.equal(res.data.version, 1);
  const farmerId = res.data.id;

  // Edit farmer
  const editRes = await api(`/api/farmers/${farmerId}`, {
    method: 'PUT',
    body: {
      full_name: 'Sundaram Pillai S.',
      village: 'South Thovalai',
      district: 'Kanyakumari',
      state: 'Tamil Nadu'
    }
  });

  assert.equal(editRes.status, 200);
  assert.equal(editRes.data.full_name, 'Sundaram Pillai S.');
  assert.equal(editRes.data.village, 'South Thovalai');
  assert.equal(editRes.data.version, 2);
});

test('feature: flower bill with applicable charges, net amount, and payment tracking', async () => {
  const farmerRes = await api('/api/farmers', {
    method: 'POST',
    body: {
      full_name: 'Kandasamy R',
      contact_number: '9842100002',
      village: 'Kottar'
    }
  });
  const farmerId = farmerRes.data.id;

  // Create bill with weight, rate, and applicable charges
  const billRes = await api('/api/collections', {
    method: 'POST',
    body: {
      farmer_id: farmerId,
      flower_type: 'Rose',
      quantity_kg: 20,
      rate_per_kg: 150,
      applicable_charges: 50, // e.g. handling/transport charge
      payment_status: 'Partial',
      amount_paid: 1500
    }
  });

  assert.equal(billRes.status, 201);
  assert.equal(billRes.data.quantity_kg, 20);
  assert.equal(billRes.data.rate_per_kg, 150);
  assert.equal(billRes.data.total_amount, 3000);
  assert.equal(billRes.data.applicable_charges, 50);
  assert.equal(billRes.data.net_amount, 3050);
  assert.equal(billRes.data.payment_status, 'Partial');
  assert.equal(billRes.data.amount_paid, 1500);

  // Update payment to Paid
  const payRes = await api(`/api/collections/${billRes.data.id}/payment`, {
    method: 'POST',
    body: {
      payment_status: 'Paid',
      payment_mode: 'UPI'
    }
  });

  assert.equal(payRes.status, 200);
  assert.equal(payRes.data.payment_status, 'Paid');
  assert.equal(payRes.data.amount_paid, 3050);
});

test('feature: 15-day automated comprehensive audit execution, report, and resolution', async () => {
  // Trigger comprehensive audit pass
  const auditRes = await api('/api/system-audit/trigger', { method: 'POST' });
  assert.equal(auditRes.status, 200);
  assert.equal(auditRes.data.success, true);
  assert.ok(auditRes.data.audit_uuid);
  assert.ok(auditRes.data.next_scheduled_audit_date);

  // Check latest audit report
  const latestRes = await api('/api/system-audit/latest');
  assert.equal(latestRes.status, 200);
  assert.equal(latestRes.data.has_run, true);
  assert.ok(latestRes.data.summary);

  // Query findings
  const findingsRes = await api('/api/system-audit/findings?status=UNRESOLVED');
  assert.equal(findingsRes.status, 200);
  assert.ok(Array.isArray(findingsRes.data.findings));

  // If there are findings, resolve one
  if (findingsRes.data.findings.length > 0) {
    const firstFinding = findingsRes.data.findings[0];
    const resolveRes = await api(`/api/system-audit/findings/${firstFinding.id}/resolve`, {
      method: 'POST',
      body: {
        status: 'RESOLVED',
        notes: 'Verified and approved by Administrator during QA check.'
      }
    });

    assert.equal(resolveRes.status, 200);
    assert.equal(resolveRes.data.resolution_status, 'RESOLVED');
    assert.equal(resolveRes.data.resolution_notes, 'Verified and approved by Administrator during QA check.');
  }
});

test('feature: real-time synchronization polling and event broadcast', async () => {
  // Poll sync events
  const syncRes = await api('/api/sync/poll?since_id=0');
  assert.equal(syncRes.status, 200);
  assert.equal(syncRes.data.success, true);
  assert.ok(Array.isArray(syncRes.data.events));
  assert.ok(syncRes.data.events.length > 0, 'mutations generated sync events');

  // Verify sync status
  const statusRes = await api('/api/sync/status');
  assert.equal(statusRes.status, 200);
  assert.ok(statusRes.data.server_time);
});

test('feature: date-wise sales and purchase summary reports', async () => {
  const summaryRes = await api('/api/reports/date-summary?group_by=day');
  assert.equal(summaryRes.status, 200);
  assert.ok(Array.isArray(summaryRes.data.period_summary));
  assert.ok(Array.isArray(summaryRes.data.flower_breakdown));
});

test('feature: dashboard statistics metrics derived from real database records', async () => {
  const dashRes = await api('/api/dashboard/stats');
  assert.equal(dashRes.status, 200);
  assert.ok(dashRes.data.farmers.total >= 2);
  assert.ok(dashRes.data.collections.all_time.count >= 1);
  assert.ok(dashRes.data.collections.all_time.total_amount > 0);
  assert.ok(dashRes.data.audit.last_audit_date);
  assert.ok(dashRes.data.audit.next_scheduled_audit_date);
});

test('feature: farmer registration with phone variations and villages in GET /api/farmers', async () => {
  // Test registration with 11-digit leading 0 phone
  const res = await api('/api/farmers', {
    method: 'POST',
    body: {
      full_name: 'Kandasamy Velan',
      name_ta: 'கந்தசாமி வேலன்',
      contact_number: '09443123456',
      village: 'Chettipalayam',
      district: 'Coimbatore',
      state: 'Tamil Nadu'
    }
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.contact_number, '9443123456');
  assert.equal(res.data.village, 'Chettipalayam');

  // Verify GET /api/farmers returns villages array including Chettipalayam
  const listRes = await api('/api/farmers');
  assert.equal(listRes.status, 200);
  assert.ok(Array.isArray(listRes.data.villages));
  assert.ok(listRes.data.villages.includes('Chettipalayam'));

  // Verify farmer is listed in farmers array
  const found = listRes.data.farmers.find(f => f.id === res.data.id);
  assert.ok(found);
  assert.equal(found.full_name, 'Kandasamy Velan');
  assert.equal(found.name_ta, 'கந்தசாமி வேலன்');
});

test('feature: manual farmer location entry, map retrieval, count and filtering', async () => {
  // Add a farmer with manual location entry
  const res = await api('/api/farmers', {
    method: 'POST',
    body: {
      full_name: 'Manual Test Farmer',
      contact_number: '9789012345',
      village: 'Nilakottai',
      district: 'Dindigul',
      latitude: 10.1654,
      longitude: 77.8521,
      location_source: 'manual',
      notes: 'Manual entry test cultivator'
    }
  });
  assert.equal(res.status, 201);
  assert.equal(res.data.latitude, 10.1654);
  assert.equal(res.data.longitude, 77.8521);
  assert.equal(res.data.location_source, 'manual');
  assert.equal(res.data.location_review_status, 'verified');

  // Verify GET /api/farmers/locations/map returns count and includes the farmer
  const mapRes = await api('/api/farmers/locations/map');
  assert.equal(mapRes.status, 200);
  assert.ok(typeof mapRes.data.count === 'number');
  assert.ok(mapRes.data.count >= 1);
  const mapFarmer = mapRes.data.farmers.find(f => f.id === res.data.id);
  assert.ok(mapFarmer);
  assert.equal(mapFarmer.village, 'Nilakottai');
  assert.equal(mapFarmer.latitude, 10.1654);
  assert.equal(mapFarmer.longitude, 77.8521);

  // Update farmer location manually via POST /api/farmers/:id/location
  const updateRes = await api(`/api/farmers/${res.data.id}/location`, {
    method: 'POST',
    body: {
      latitude: 10.1700,
      longitude: 77.8600,
      village: 'Nilakottai North',
      source: 'Manual Admin Entry',
      notes: 'Updated manual coordinates'
    }
  });
  assert.equal(updateRes.status, 200);
  assert.equal(updateRes.data.latitude, 10.1700);
  assert.equal(updateRes.data.longitude, 77.8600);
  assert.equal(updateRes.data.village, 'Nilakottai North');
});


