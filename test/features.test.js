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
