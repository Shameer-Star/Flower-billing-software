// API tests. Each run uses its own temporary database, never data/fresh_blooms.sqlite.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('events');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-blooms-test-'));
process.env.DB_PATH = path.join(tmpDir, 'test.sqlite');
process.env.ADMIN_INITIAL_USERNAME = 'admin';
process.env.ADMIN_INITIAL_PASSWORD = 'Test@12345';
process.env.MAX_FARMERS = '300';

const app = require('../server');
const db = require('../db');
const dates = require('../dates');

let server;
let base;
let token;

async function api(urlPath, { method = 'GET', body, auth = true, raw } = {}) {
  const headers = {};
  if (auth && token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined || raw !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(base + urlPath, {
    method,
    headers,
    body: raw !== undefined ? raw : body !== undefined ? JSON.stringify(body) : undefined
  });
  const type = res.headers.get('content-type') || '';
  const data = type.includes('json') ? await res.json() : await res.text();
  return { status: res.status, data, headers: res.headers };
}

let phoneSeq = 9000000000;
async function createFarmer(extra = {}) {
  phoneSeq += 1;
  const res = await api('/api/farmers', {
    method: 'POST',
    body: { full_name: 'Test Farmer', contact_number: String(phoneSeq), village: 'Thovalai', ...extra }
  });
  assert.equal(res.status, 201, JSON.stringify(res.data));
  return res.data;
}

before(async () => {
  server = app.listen(0);
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => {
  server.close();
  db.closeDatabase(); // Windows can't delete an open database file
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('dates: fortnights and local (IST) dates', () => {
  assert.deepEqual(dates.fortnightRange('2026-02-2'), { start: '2026-02-16', end: '2026-02-28' });
  assert.deepEqual(dates.fortnightRange('2028-02-2'), { start: '2028-02-16', end: '2028-02-29' });
  assert.equal(dates.fortnightKey('2026-10-15'), '2026-10-1');
  assert.equal(dates.fortnightKey('2026-10-16'), '2026-10-2');
  assert.equal(dates.previousFortnightKey('2026-01-1'), '2025-12-2');
  assert.deepEqual(dates.lastFortnights('2026-10-17', 3), ['2026-09-2', '2026-10-1', '2026-10-2']);
  // 01:30 IST on 17 Oct is still 16 Oct in UTC; the business date must be the 17th
  assert.equal(dates.localDate(new Date('2026-10-16T20:00:00Z')), '2026-10-17');
  assert.equal(dates.isDateStr('2026-02-30'), false);
});

test('login: wrong password is rejected, right password returns a token', async () => {
  const bad = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'nope' }, auth: false });
  assert.equal(bad.status, 401);
  assert.equal(bad.data.code, 'invalid_credentials');

  const ok = await api('/api/auth/login', { method: 'POST', body: { username: 'admin', password: 'Test@12345' }, auth: false });
  assert.equal(ok.status, 200);
  assert.ok(ok.data.token);
  token = ok.data.token;
});

test('protected routes need a token; unknown API routes return JSON 404', async () => {
  const noAuth = await api('/api/farmers/options', { auth: false });
  assert.equal(noAuth.status, 401);
  assert.equal(noAuth.data.code, 'unauthorized');

  const missing = await api('/api/does-not-exist');
  assert.equal(missing.status, 404);
  assert.equal(missing.data.code, 'not_found');
});

test('malformed JSON and missing bodies are 400s, not crashes', async () => {
  const malformed = await api('/api/farmers', { method: 'POST', raw: '{"full_name":' });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.data.code, 'malformed_json');

  const noBody = await api('/api/collections', { method: 'POST' });
  assert.equal(noBody.status, 400);
  assert.equal(noBody.data.code, 'farmer_required');
});

test('farmers: register with Tamil name and GPS, reject duplicates and bad input', async () => {
  const farmer = await createFarmer({ full_name: 'Murugan Velu', name_ta: 'முருகன் வேலு', latitude: 8.2435, longitude: 77.4982 });
  assert.match(farmer.id, /^FAR-\d+$/);
  assert.equal(farmer.name_ta, 'முருகன் வேலு');
  assert.equal(farmer.location_review_status, 'verified');
  assert.equal(farmer.last_location_reviewed_at, dates.localDate());

  const dup = await api('/api/farmers', { method: 'POST', body: { full_name: 'X', contact_number: farmer.contact_number, village: 'Y' } });
  assert.equal(dup.status, 409);
  assert.equal(dup.data.code, 'duplicate_phone');

  const noVillage = await api('/api/farmers', { method: 'POST', body: { full_name: 'X', contact_number: '9111111111' } });
  assert.equal(noVillage.data.code, 'village_required');

  const numericName = await api('/api/farmers', { method: 'POST', body: { full_name: 12345, contact_number: 9222222222, village: 'Y' } });
  assert.equal(numericName.status, 201, 'numbers in JSON must not crash the handler');
});

test('ids keep counting past 9999 and skip ids added outside the app', async () => {
  db.run("UPDATE sequences SET value = 9998 WHERE name = 'farmers:FAR-'");
  const a = await createFarmer();
  const b = await createFarmer();
  assert.equal(a.id, 'FAR-9999');
  assert.equal(b.id, 'FAR-10000');

  // An id taken by an import/seed makes the counter resync instead of failing
  const now = new Date().toISOString();
  db.run(
    "INSERT INTO farmers (id, full_name, contact_number, village, created_at, updated_at) VALUES ('FAR-10001', 'Imported', '9333333333', 'V', ?, ?)",
    [now, now]
  );
  const c = await createFarmer();
  assert.equal(c.id, 'FAR-10002');
});

test('collections: amount is weight x price; invalid input is rejected with codes', async () => {
  const farmer = await createFarmer();
  const today = dates.localDate();

  const ok = await api('/api/collections', {
    method: 'POST',
    body: { farmer_id: farmer.id, collection_date: today, flower_type: 'Jasmine', quantity_kg: '12.5', rate_per_kg: 480 }
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.data));
  assert.equal(ok.data.total_amount, 6000);
  assert.equal(ok.data.payment_status, 'Pending');

  const cases = [
    [{ flower_type: 'Tulip', quantity_kg: 1, rate_per_kg: 1 }, 'invalid_flower'],
    [{ flower_type: 'Rose', quantity_kg: '12abc', rate_per_kg: 1 }, 'invalid_weight'],
    [{ flower_type: 'Rose', quantity_kg: 0, rate_per_kg: 1 }, 'invalid_weight'],
    [{ flower_type: 'Rose', quantity_kg: 1, rate_per_kg: -5 }, 'invalid_price'],
    [{ flower_type: 'Rose', quantity_kg: 1, rate_per_kg: 1, collection_date: dates.addDays(today, 1) }, 'date_in_future'],
    [{ flower_type: 'Rose', quantity_kg: 1, rate_per_kg: 1, collection_date: '2026-02-30' }, 'invalid_date'],
    [{ flower_type: 'Rose', quantity_kg: 1, rate_per_kg: 1, payment_status: '<img src=x onerror=alert(1)>' }, 'invalid_payment_status']
  ];
  for (const [body, code] of cases) {
    const res = await api('/api/collections', { method: 'POST', body: { farmer_id: farmer.id, ...body } });
    assert.equal(res.status, 400, `${code}: ${JSON.stringify(res.data)}`);
    assert.equal(res.data.code, code);
  }
});

test('cancelling a bill recomputes farmer totals and day totals exclude it', async () => {
  const farmer = await createFarmer();
  const today = dates.localDate();
  const post = body => api('/api/collections', { method: 'POST', body: { farmer_id: farmer.id, flower_type: 'Rose', ...body } });

  const first = await post({ quantity_kg: 10, rate_per_kg: 100 });
  await post({ quantity_kg: 5, rate_per_kg: 100 });

  let profile = await api(`/api/farmers/${farmer.id}`);
  assert.equal(profile.data.total_collected_kg, 15);
  assert.equal(profile.data.total_payout, 1500);

  const noReason = await api(`/api/collections/${first.data.id}/cancel`, { method: 'POST', body: {} });
  assert.equal(noReason.data.code, 'reason_required');

  const cancel = await api(`/api/collections/${first.data.id}/cancel`, { method: 'POST', body: { reason: 'Wrong weight' } });
  assert.equal(cancel.status, 200);
  const again = await api(`/api/collections/${first.data.id}/cancel`, { method: 'POST', body: { reason: 'Again' } });
  assert.equal(again.data.code, 'already_cancelled');

  profile = await api(`/api/farmers/${farmer.id}`);
  assert.equal(profile.data.total_collected_kg, 5);
  assert.equal(profile.data.total_payout, 500);

  const list = await api(`/api/collections?date=${today}&search=${farmer.id}&limit=200`);
  assert.equal(list.data.collections.length, 2, 'cancelled bill is still listed');
  assert.deepEqual(list.data.totals, { entries: 1, kg: 5, amount: 500 });

  const pay = await api(`/api/collections/${first.data.id}/payment`, { method: 'POST', body: { payment_status: 'Paid' } });
  assert.equal(pay.data.code, 'already_cancelled');
});

test('farmer picker lists every active farmer (no 100-row cap)', async () => {
  const now = new Date().toISOString();
  db.transaction(() => {
    for (let i = 0; i < 120; i++) {
      db.run(
        'INSERT INTO farmers (id, full_name, contact_number, village, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [`BULK-${i}`, `Bulk ${i}`, `80000${String(i).padStart(5, '0')}`, 'Hosur', now, now]
      );
    }
  });
  const res = await api('/api/farmers/options');
  assert.equal(res.status, 200);
  assert.ok(res.data.farmers.length >= 120, `got ${res.data.farmers.length}`);
});

test('audit: six fortnights ending now; a location check today counts as checked', async () => {
  const farmer = await createFarmer({ full_name: 'Audit Farmer' });
  const before = await api('/api/audit');
  assert.equal(before.status, 200);
  assert.equal(before.data.fortnights.length, 6);
  const current = before.data.fortnights[5];
  assert.equal(current.key, dates.fortnightKey(dates.localDate()));
  assert.equal(before.data.selected, current.key);
  assert.equal(before.data.farmers.find(f => f.id === farmer.id).checked_on, null);

  const check = await api(`/api/farmers/${farmer.id}/location`, { method: 'POST', body: { latitude: 10.165, longitude: 77.851 } });
  assert.equal(check.status, 200);
  const badCheck = await api(`/api/farmers/${farmer.id}/location`, { method: 'POST', body: { latitude: 'abc', longitude: 77 } });
  assert.equal(badCheck.data.code, 'invalid_location');

  const afterCheck = await api('/api/audit');
  const row = afterCheck.data.farmers.find(f => f.id === farmer.id);
  assert.equal(row.checked_on, dates.localDate());
  assert.equal(row.latitude, 10.165);
  assert.equal(afterCheck.data.fortnights[5].farmers_checked, current.farmers_checked + 1);

  const older = await api(`/api/audit?fortnight=${before.data.fortnights[0].key}`);
  assert.equal(older.data.selected, before.data.fortnights[0].key);
  const bogus = await api('/api/audit?fortnight=1999-01-1');
  assert.equal(bogus.data.selected, current.key);
});

test('CSV export: needs a token, UTF-8 BOM, Tamil names, quotes and formulas escaped', async () => {
  const farmer = await createFarmer({ full_name: '=HYPERLINK("x") "Raja"', name_ta: 'ராஜா' });
  await api('/api/collections', { method: 'POST', body: { farmer_id: farmer.id, flower_type: 'Lotus', quantity_kg: 2, rate_per_kg: 150 } });

  const noAuth = await api('/api/reports/export/collections-csv', { auth: false });
  assert.equal(noAuth.status, 401);

  const today = dates.localDate();
  const res = await api(`/api/reports/export/collections-csv?from=${today}&to=${today}`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  assert.match(res.headers.get('content-disposition'), new RegExp(`collections_${today}_to_${today}\\.csv`));
  // fetch().text() strips a BOM, so check the raw bytes
  const raw = Buffer.from(await (await fetch(`${base}/api/reports/export/collections-csv`, { headers: { Authorization: `Bearer ${token}` } })).arrayBuffer());
  assert.deepEqual([...raw.subarray(0, 3)], [0xef, 0xbb, 0xbf]);
  assert.ok(res.data.includes('"ராஜா"'));
  assert.ok(res.data.includes(`"'=HYPERLINK(""x"") ""Raja"""`), res.data);
});

test('a retried save with the same client_ref returns the first bill, not a duplicate', async () => {
  const farmer = await createFarmer();
  const body = { farmer_id: farmer.id, flower_type: 'Rose', quantity_kg: 3, rate_per_kg: 100, client_ref: 'test-ref-123' };
  const first = await api('/api/collections', { method: 'POST', body });
  const retry = await api('/api/collections', { method: 'POST', body });
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal(retry.data.id, first.data.id);
  const list = await api(`/api/collections?search=${farmer.id}&limit=200`);
  assert.equal(list.data.collections.length, 1);
});

test('audit ?farmers=0 returns period summaries only', async () => {
  const res = await api('/api/audit?farmers=0');
  assert.equal(res.status, 200);
  assert.equal(res.data.fortnights.length, 6);
  assert.equal(res.data.farmers, undefined);
});

test('backup downloads a real SQLite file', async () => {
  const res = await fetch(`${base}/api/backup`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(res.status, 200);
  const bytes = Buffer.from(await res.arrayBuffer());
  assert.equal(bytes.subarray(0, 15).toString(), 'SQLite format 3');
});

// Kept last: it fills the database up to the farmer limit
test('registering beyond MAX_FARMERS is refused with farmer_limit', async () => {
  const active = db.queryOne("SELECT COUNT(*) AS n FROM farmers WHERE status = 'active'").n;
  const now = new Date().toISOString();
  db.transaction(() => {
    for (let i = active; i < 300; i++) {
      db.run(
        'INSERT INTO farmers (id, full_name, contact_number, village, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
        [`CAP-${i}`, `Cap ${i}`, `70000${String(i).padStart(5, '0')}`, 'Attur', now, now]
      );
    }
  });
  const res = await api('/api/farmers', { method: 'POST', body: { full_name: 'One too many', contact_number: '9444444444', village: 'Attur' } });
  assert.equal(res.status, 409);
  assert.equal(res.data.code, 'farmer_limit');
});
