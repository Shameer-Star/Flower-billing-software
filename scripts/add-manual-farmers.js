const db = require('../db');
const { localDate, addDays } = require('../dates');

async function addManualFarmers() {
  await db.initDatabase();

  const farmersToAdd = [
    {
      id: 'FAR-1004',
      full_name: 'Kannan Muthu',
      name_ta: 'கண்ணன் முத்து',
      contact_number: '9842156789',
      village: 'Nilakottai',
      village_ta: 'நிலக்கோட்டை',
      address: 'Plot 14, Main Road Flower Farms',
      district: 'Dindigul',
      state: 'Tamil Nadu',
      latitude: 10.1654,
      longitude: 77.8521,
      location_source: 'manual',
      notes: 'Manual entry farmer - Jasmine & Rose farm 3.5 acres'
    },
    {
      id: 'FAR-1005',
      full_name: 'Lakshmi Ammal',
      name_ta: 'லட்சுமி அம்மாள்',
      contact_number: '9443218765',
      village: 'Hosur',
      village_ta: 'ஓசூர்',
      address: 'Survey No. 82, Bagalur Road',
      district: 'Krishnagiri',
      state: 'Tamil Nadu',
      latitude: 12.7412,
      longitude: 77.8285,
      location_source: 'manual',
      notes: 'Manual entry farmer - Dutch Roses and Chrysanthemum greenhouse'
    }
  ];

  const now = new Date().toISOString();
  const today = localDate();
  const nextDue = addDays(today, 15);

  db.transaction(() => {
    for (const f of farmersToAdd) {
      const existing = db.queryOne('SELECT id FROM farmers WHERE id = ? OR contact_number = ?', [f.id, f.contact_number]);
      if (existing) {
        console.log(`Farmer ${f.id} / ${f.contact_number} already exists, updating location...`);
        db.run(`
          UPDATE farmers SET
            full_name = ?, name_ta = ?, contact_number = ?, village = ?, village_ta = ?,
            address = ?, district = ?, state = ?, latitude = ?, longitude = ?,
            location_source = 'manual', location_review_status = 'verified',
            last_location_reviewed_at = ?, next_location_review_due_at = ?, notes = ?, updated_at = ?
          WHERE id = ?
        `, [
          f.full_name, f.name_ta, f.contact_number, f.village, f.village_ta,
          f.address, f.district, f.state, f.latitude, f.longitude,
          today, nextDue, f.notes, now, f.id
        ]);
      } else {
        console.log(`Inserting manual entry farmer ${f.id} (${f.full_name})...`);
        db.run(`
          INSERT INTO farmers (
            id, full_name, name_ta, contact_number, village, village_ta, address, district, state,
            latitude, longitude, location_source, location_review_status, last_location_reviewed_at,
            next_location_review_due_at, status, total_collected_kg, total_payout, notes, is_synthetic, version, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'verified', ?, ?, 'active', 0, 0, ?, 0, 1, ?, ?)
        `, [
          f.id, f.full_name, f.name_ta, f.contact_number, f.village, f.village_ta,
          f.address, f.district, f.state, f.latitude, f.longitude,
          f.location_source, today, nextDue, f.notes, now, now
        ]);

        db.run(`
          INSERT INTO farmer_locations (
            farmer_id, latitude, longitude, village, address, source, verification_status,
            verified_by, capture_timestamp, review_notes, created_at
          ) VALUES (?, ?, ?, ?, ?, 'manual', 'verified', 'System Administrator', ?, 'Manual entry farmer stored with GPS coordinates', ?)
        `, [f.id, f.latitude, f.longitude, f.village, f.address, now, now]);

        db.logAudit('SYSTEM', 'System Administrator', 'FARMER_REGISTERED', 'farmers', f.id,
          `Manual entry farmer ${f.full_name} (${f.id}) registered with location (${f.latitude}, ${f.longitude})`);
      }
    }

    // Ensure sequences updated
    db.run("INSERT INTO sequences (name, value) VALUES ('farmers:FAR-', 1005) ON CONFLICT(name) DO UPDATE SET value = MAX(value, 1005)");
  });

  console.log('Successfully stored manual entry farmers.');
  const allFarmers = db.query("SELECT id, full_name, village, latitude, longitude, location_review_status, location_source FROM farmers");
  console.log('All farmers in database:', allFarmers);
}

if (require.main === module) {
  addManualFarmers().then(() => process.exit(0)).catch(err => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { addManualFarmers };
