const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { once } = require('events');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fresh-blooms-selling-test-'));
process.env.DB_PATH = path.join(tmpDir, 'selling_test.sqlite');
process.env.ADMIN_INITIAL_USERNAME = 'admin';
process.env.ADMIN_INITIAL_PASSWORD = 'Test@12345';

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

test('requirement 1 & 2: farmer customizable 15, 20, 30-day billing cycle and editable commission rate', async () => {
  // 1. Register farmer with 20-day cycle and 8% custom commission
  const res20 = await api('/api/farmers', {
    method: 'POST',
    body: {
      full_name: 'Venkatesan G',
      contact_number: '9842100088',
      village: 'Nilakottai',
      billing_cycle_days: 20,
      commission_rate: 8.0
    }
  });
  assert.equal(res20.status, 201);
  assert.equal(res20.data.billing_cycle_days, 20);
  assert.equal(res20.data.commission_rate, 8.0);
  const farmer20Id = res20.data.id;

  // 2. Register farmer with 30-day cycle and default 10% commission
  const res30 = await api('/api/farmers', {
    method: 'POST',
    body: {
      full_name: 'Muthusamy K',
      contact_number: '9842100089',
      village: 'Sathyamangalam',
      billing_cycle_days: 30
    }
  });
  assert.equal(res30.status, 201);
  assert.equal(res30.data.billing_cycle_days, 30);
  assert.equal(res30.data.commission_rate, 10.0);
  const farmer30Id = res30.data.id;

  // 3. Edit farmer commission rate (customize to 12%) and cycle (to 15-day)
  const editRes = await api(`/api/farmers/${farmer30Id}`, {
    method: 'PUT',
    body: {
      billing_cycle_days: 15,
      commission_rate: 12.0
    }
  });
  assert.equal(editRes.status, 200);
  assert.equal(editRes.data.billing_cycle_days, 15);
  assert.equal(editRes.data.commission_rate, 12.0);

  // 4. Record collection for farmer with 8% commission and deduct_commission: true
  const colRes = await api('/api/collections', {
    method: 'POST',
    body: {
      farmer_id: farmer20Id,
      flower_type: 'Jasmine',
      quantity_kg: 10,
      rate_per_kg: 500, // 10 x 500 = 5000 gross
      deduct_commission: true // 8% commission = 400, net payout = 4600
    }
  });
  assert.equal(colRes.status, 201);
  assert.equal(colRes.data.gross_amount, 5000);
  assert.equal(colRes.data.commission_rate, 8.0);
  assert.equal(colRes.data.commission_amount, 400);
  assert.equal(colRes.data.net_amount, 4600);

  // 5. Generate Farmer Settlement Statement
  const stmtRes = await api(`/api/farmers/${farmer20Id}/billing-statement`);
  assert.equal(stmtRes.status, 200);
  assert.equal(stmtRes.data.farmer.billing_cycle_days, 20);
  assert.equal(stmtRes.data.totals.total_gross, 5000);
  assert.equal(stmtRes.data.totals.total_commission, 400);
  assert.equal(stmtRes.data.totals.total_net_payable, 4600);

  // 6. Summary of all farmer settlements
  const summRes = await api('/api/farmers/settlements/summary');
  assert.equal(summRes.status, 200);
  assert.ok(Array.isArray(summRes.data.farmers));
  const fSummary = summRes.data.farmers.find(f => f.id === farmer20Id);
  assert.ok(fSummary);
  assert.equal(fSummary.billing_cycle_days, 20);
  assert.equal(fSummary.cycle_gross, 5000);
});

test('requirement 3: selling management module with 20-25 buyers seeded and CRUD operations', async () => {
  // Check seeded buyers (should be >= 25)
  const listRes = await api('/api/buyers');
  assert.equal(listRes.status, 200);
  assert.ok(listRes.data.buyers.length >= 25);
  assert.ok(listRes.data.cities.length >= 5);
  assert.ok(listRes.data.summary.total_buyers >= 25);

  // Verify specific seeded wholesale buyers
  const buyer1 = listRes.data.buyers.find(b => b.id === 'BUY-1001');
  assert.ok(buyer1);
  assert.equal(buyer1.name, 'Sri Murugan Flower Mart');
  assert.equal(buyer1.market_city, 'Chennai');
  assert.equal(buyer1.billing_cycle_days, 6);

  const buyer2 = listRes.data.buyers.find(b => b.id === 'BUY-1002');
  assert.ok(buyer2);
  assert.equal(buyer2.name, 'Meenakshi Malar Nilayam');
  assert.equal(buyer2.market_city, 'Madurai');
  assert.equal(buyer2.billing_cycle_days, 5);

  // Register new buyer
  const createRes = await api('/api/buyers', {
    method: 'POST',
    body: {
      name: 'Pooja Floral Exports',
      name_ta: 'பூஜா மலர் ஏற்றுமதி',
      phone: '9840999888',
      market_city: 'Coimbatore',
      billing_cycle_days: 6,
      credit_limit: 150000
    }
  });
  assert.equal(createRes.status, 201);
  assert.equal(createRes.data.name, 'Pooja Floral Exports');
  assert.equal(createRes.data.market_city, 'Coimbatore');
  const newBuyerId = createRes.data.id;

  // Record customer payment on outstanding balance
  const payRes = await api(`/api/buyers/${buyer1.id}/payment`, {
    method: 'POST',
    body: {
      amount: 5000,
      payment_mode: 'UPI'
    }
  });
  assert.equal(payRes.status, 200);
  assert.equal(payRes.data.amount_paid, 5000);
});

test('requirement 4: track buyer-wise flower distribution from different procurement locations', async () => {
  const today = dates.localDate();

  // Record distribution from Thovalai procurement center
  const distRes1 = await api('/api/selling/distributions', {
    method: 'POST',
    body: {
      buyer_id: 'BUY-1003',
      distribution_date: today,
      procurement_location: 'Thovalai',
      flower_type: 'Jasmine',
      variety: 'First Grade Mogra',
      quantity_kg: 35.5,
      rate_per_kg: 490,
      coolie_charges: 100,
      transport_charges: 150,
      vehicle_number: 'TN-74-A-1234'
    }
  });
  assert.equal(distRes1.status, 201);
  assert.equal(distRes1.data.procurement_location, 'Thovalai');
  assert.equal(distRes1.data.flower_type, 'Jasmine');
  assert.equal(distRes1.data.quantity_kg, 35.5);
  assert.equal(distRes1.data.total_amount, 17395);
  assert.equal(distRes1.data.bill_status, 'unbilled');

  // Record distribution from Hosur procurement center
  const distRes2 = await api('/api/selling/distributions', {
    method: 'POST',
    body: {
      buyer_id: 'BUY-1003',
      distribution_date: today,
      procurement_location: 'Hosur',
      flower_type: 'Rose',
      variety: 'Dutch Rose Red',
      quantity_kg: 50.0,
      rate_per_kg: 140,
      coolie_charges: 120,
      transport_charges: 200,
      vehicle_number: 'TN-70-F-5678'
    }
  });
  assert.equal(distRes2.status, 201);
  assert.equal(distRes2.data.procurement_location, 'Hosur');
  assert.equal(distRes2.data.total_amount, 7000);

  // Filter distributions by procurement location
  const locRes = await api('/api/selling/distributions?procurement_location=Thovalai');
  assert.equal(locRes.status, 200);
  assert.ok(locRes.data.distributions.length > 0);
  assert.ok(locRes.data.distributions.every(d => d.procurement_location === 'Thovalai'));

  // Location summary breakdown
  const summaryRes = await api('/api/selling/distributions/summary');
  assert.equal(summaryRes.status, 200);
  assert.ok(Array.isArray(summaryRes.data.location_breakdown));
  const thovalaiBreakdown = summaryRes.data.location_breakdown.find(l => l.procurement_location === 'Thovalai');
  assert.ok(thovalaiBreakdown);
  assert.ok(thovalaiBreakdown.total_kg > 0);
});

test('requirement 5 & 6: generate consolidated 5-6 day selling bills in client existing format', async () => {
  const today = dates.localDate();
  const start5 = dates.addDays(today, -5);

  // Generate 5-day consolidated selling bill for BUY-1002
  const billRes = await api('/api/selling/bills/generate', {
    method: 'POST',
    body: {
      buyer_id: 'BUY-1002',
      period_start_date: start5,
      period_end_date: today,
      bill_date: today,
      coolie_charges: 500,
      transport_charges: 800,
      amount_paid: 20000,
      payment_mode: 'Bank Transfer'
    }
  });
  assert.equal(billRes.status, 201);
  assert.ok(billRes.data.id.startsWith('SB-'));
  assert.equal(billRes.data.buyer_id, 'BUY-1002');
  assert.equal(billRes.data.billing_cycle_days, 6);
  assert.ok(billRes.data.total_kg > 0);
  assert.ok(billRes.data.total_payable > 0);
  assert.equal(billRes.data.amount_paid, 20000);
  const billId = billRes.data.id;

  // Retrieve bill in Client Existing Selling Bill Format
  const getBillRes = await api(`/api/selling/bills/${billId}`);
  assert.equal(getBillRes.status, 200);
  assert.ok(getBillRes.data.bill);
  assert.ok(getBillRes.data.buyer);
  assert.ok(Array.isArray(getBillRes.data.items));
  assert.ok(getBillRes.data.items.length > 0);
  assert.ok(getBillRes.data.shop.name.includes('Fresh Blooms'));
  assert.ok(getBillRes.data.shop.name_ta.includes('கமிஷன் மண்டி'));

  // Test individual Excel export for this bill
  const excelRes = await api(`/api/selling/bills/${billId}/export-excel`);
  assert.equal(excelRes.status, 200);
  assert.ok(excelRes.data.includes('TOTAL FLOWER WEIGHT'));
  assert.ok(excelRes.data.includes('NET TOTAL PAYABLE'));
});

test('requirement 7: maintain Excel/CSV export and import functionality', async () => {
  // 1. Export buyers CSV
  const buyersCsv = await api('/api/reports/export/buyers-csv');
  assert.equal(buyersCsv.status, 200);
  assert.ok(buyersCsv.data.includes('Sri Murugan Flower Mart'));

  // 2. Export distributions CSV
  const distCsv = await api('/api/reports/export/distributions-csv');
  assert.equal(distCsv.status, 200);
  assert.ok(distCsv.data.includes('Distribution ID'));

  // 3. Export selling bills CSV
  const billsCsv = await api('/api/reports/export/selling-bills-csv');
  assert.equal(billsCsv.status, 200);
  assert.ok(billsCsv.data.includes('Bill Number'));

  // 4. Bulk import farmers via CSV
  const farmerCsvData = `name,contact_number,village,billing_cycle,commission
"Arulraj G","9842199881","Thovalai",20,8
"Devendran M","9842199882","Nilakottai",30,12`;

  const importFarmersRes = await api('/api/import/farmers', {
    method: 'POST',
    body: { csv: farmerCsvData }
  });
  assert.equal(importFarmersRes.status, 200);
  assert.equal(importFarmersRes.data.imported, 2);

  // 5. Bulk import buyers via CSV
  const buyerCsvData = `name,phone,city,billing_cycle,credit_limit
"Madurai Royal Florist","9842199883","Madurai",5,120000
"Nellai Jasmine Traders","9842199884","Tirunelveli",6,80000`;

  const importBuyersRes = await api('/api/import/buyers', {
    method: 'POST',
    body: { csv: buyerCsvData }
  });
  assert.equal(importBuyersRes.status, 200);
  assert.equal(importBuyersRes.data.imported, 2);
});
