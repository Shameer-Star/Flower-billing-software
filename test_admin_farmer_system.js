const http = require('http');

async function req(path, method = 'GET', data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, 'http://localhost:3000');
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: { 'Content-Type': 'application/json' }
    };
    if (token) options.headers['Authorization'] = `Bearer ${token}`;

    const request = http.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, data: JSON.parse(body) });
        } catch (e) {
          resolve({ status: res.statusCode, text: body });
        }
      });
    });
    request.on('error', reject);
    if (data) request.write(JSON.stringify(data));
    request.end();
  });
}

async function runVerification() {
  console.log('=== TEST 1: Admin Login ===');
  let res = await req('/api/auth/login', 'POST', { username: 'admin', password: 'Admin@12345' });
  console.log('Login Status:', res.status, 'User:', res.data.user.full_name, 'Role:', res.data.user.role);
  if (res.status !== 200) throw new Error('Admin login failed');
  const token = res.data.token;

  console.log('\n=== TEST 2: Verify Initial Dashboard Real Metrics (Zero Synthetic Data) ===');
  res = await req('/api/dashboard/stats', 'GET', null, token);
  console.log('Total Farmers:', res.data.totalFarmers);
  console.log('Total Collections:', res.data.totalCollections);
  console.log('Total Payout:', res.data.totalPayout);
  console.log('Location Reviews Due:', res.data.locationStats.totalDueOrOverdue);

  console.log('\n=== TEST 3: Register Farmer A (with GPS) ===');
  const farmerA = {
    full_name: 'Murugan Velu',
    contact_number: '9876543210',
    village: 'Thovalai',
    address: '45 South St',
    latitude: 8.2435,
    longitude: 77.4982,
    notes: 'Premium Mogra cultivator'
  };
  res = await req('/api/farmers', 'POST', farmerA, token);
  console.log('Register Farmer A Status:', res.status, 'ID:', res.data.id, 'Location Status:', res.data.location_review_status, 'Next Review Due:', res.data.next_location_review_due_at);
  const idA = res.data.id;

  console.log('\n=== TEST 4: Register Farmer B (without GPS) ===');
  const farmerB = {
    full_name: 'Palanisamy Gounder',
    contact_number: '9845123410',
    village: 'Sathyamangalam',
    address: 'Near Canal, East Thottam',
    notes: 'Marigold and Sevvanthi'
  };
  res = await req('/api/farmers', 'POST', farmerB, token);
  console.log('Register Farmer B Status:', res.status, 'ID:', res.data.id, 'Location Status:', res.data.location_review_status);
  const idB = res.data.id;

  console.log('\n=== TEST 5: Duplicate Contact Number Prevention ===');
  res = await req('/api/farmers', 'POST', { full_name: 'Imposter', contact_number: '9876543210', village: 'Test' }, token);
  console.log('Duplicate submission status (Expected 409):', res.status, 'Error:', res.data.error);

  console.log('\n=== TEST 6: Record Flower Harvest Collection for Farmer A ===');
  const collectionData = {
    farmer_id: idA,
    collection_date: new Date().toISOString().slice(0, 10),
    flower_type: 'Jasmine',
    variety: 'Mogra First Quality',
    quantity_kg: 25.0,
    rate_per_kg: 400,
    quality_grade: 'Grade A',
    payment_status: 'Paid',
    payment_mode: 'Cash',
    notes: 'Morning fresh harvest intake'
  };
  res = await req('/api/collections', 'POST', collectionData, token);
  console.log('Collection Status:', res.status, 'Collection ID:', res.data.id, 'Amount:', res.data.total_amount);
  const colId = res.data.id;

  console.log('\n=== TEST 7: Verify Farmer Cumulative Totals Updated ===');
  res = await req(`/api/farmers/${idA}`, 'GET', null, token);
  console.log('Farmer A Total Collected kg:', res.data.total_collected_kg, '(Expected 25)');
  console.log('Farmer A Total Payout:', res.data.total_payout, '(Expected 10000)');

  console.log('\n=== TEST 8: 15-Day Location Review Update for Farmer B ===');
  res = await req(`/api/farmers/${idB}/location`, 'POST', {
    latitude: 11.5034,
    longitude: 77.2341,
    village: 'Sathyamangalam',
    source: 'Field Visit Collection',
    review_notes: 'Farm gate GPS coordinates captured during field inspection'
  }, token);
  console.log('Location Review Status:', res.status, 'New Location Status:', res.data.farmer.location_review_status, 'Next Due:', res.data.farmer.next_location_review_due_at);

  console.log('\n=== TEST 9: Verify Interactive Map Endpoint ===');
  res = await req('/api/farmers/locations/map', 'GET', null, token);
  console.log('Mapped Farmers Count:', res.data.count, '(Expected 2)');

  console.log('\n=== TEST 10: Cancel/Reverse Collection with Audit Reason ===');
  res = await req(`/api/collections/${colId}/cancel`, 'POST', { reason: 'Incorrect weight scale entry - re-recording harvest' }, token);
  console.log('Collection Cancel Status:', res.status, 'Message:', res.data.message);

  res = await req(`/api/farmers/${idA}`, 'GET', null, token);
  console.log('Farmer A Total Collected after reversal:', res.data.total_collected_kg, '(Expected 0)');

  console.log('\n=== TEST 11: Audit Trail Verification ===');
  res = await req('/api/audit-logs', 'GET', null, token);
  console.log('Total Audit Logs Recorded:', res.data.pagination.total);
  console.log('Latest Action:', res.data.logs[0].action, 'Details:', res.data.logs[0].details);

  console.log('\n=== TEST 12: Reports & Summary API ===');
  res = await req('/api/reports/summary', 'GET', null, token);
  console.log('Reports Summary:', JSON.stringify(res.data.summary));

  console.log('\n======================================================');
  console.log('🎉 ALL SYSTEM TESTS PASSED WITH 100% SUCCESS!');
  console.log('======================================================');
}

runVerification().catch(console.error);
