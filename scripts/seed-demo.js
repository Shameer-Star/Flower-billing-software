#!/usr/bin/env node
// Synthetic demo data: farmers in Tamil Nadu flower villages, purchases and fortnightly
// location checks. Every farmer it creates has is_synthetic = 1.
//
//   node scripts/seed-demo.js                 replace the synthetic farmers (real farmers untouched)
//   node scripts/seed-demo.js --clear         remove synthetic farmers and their purchases/checks only
//   node scripts/seed-demo.js --fresh         remove ALL farmers, purchases and checks first, then seed
//   --farmers 500                             how many farmers (default 500, max MAX_FARMERS / 2000)
//   --days 90                                 days of purchase history (default 90)
//
// Writes to DB_PATH if set, otherwise data/fresh_blooms.sqlite.
const db = require('../db');
const { localDate, addDays, daysBetween, fortnightKey, fortnightRange, lastFortnights } = require('../dates');

const argv = process.argv.slice(2);
const flag = name => argv.includes(name);
const option = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? parseInt(argv[i + 1], 10) : fallback;
};
const MAX_FARMERS = parseInt(process.env.MAX_FARMERS, 10) || 2000;
const FARMER_COUNT = Math.max(1, Math.min(MAX_FARMERS, option('--farmers', 500)));
const DAYS_OF_HISTORY = Math.max(15, Math.min(730, option('--days', 90)));

// Deterministic random numbers so the demo looks the same on every run of the same day
function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(20261017);
const between = (min, max) => min + rand() * (max - min);
const pick = list => list[Math.floor(rand() * list.length)];

const VILLAGES = [
  { en: 'Thovalai', ta: 'தோவாளை', lat: 8.232, lng: 77.506, flowers: ['Jasmine', 'Marigold', 'Crossandra'] },
  { en: 'Nilakottai', ta: 'நிலக்கோட்டை', lat: 10.165, lng: 77.851, flowers: ['Jasmine', 'Rose', 'Tuberose'] },
  { en: 'Sathyamangalam', ta: 'சத்தியமங்கலம்', lat: 11.504, lng: 77.238, flowers: ['Jasmine', 'Marigold', 'Tuberose'] },
  { en: 'Hosur', ta: 'ஓசூர்', lat: 12.740, lng: 77.825, flowers: ['Rose', 'Chrysanthemum', 'Lily'] },
  { en: 'Usilampatti', ta: 'உசிலம்பட்டி', lat: 9.969, lng: 77.788, flowers: ['Jasmine', 'Crossandra', 'Marigold'] },
  { en: 'Sankarankovil', ta: 'சங்கரன்கோவில்', lat: 9.172, lng: 77.544, flowers: ['Jasmine', 'Lotus', 'Marigold'] },
  { en: 'Aruppukottai', ta: 'அருப்புக்கோட்டை', lat: 9.514, lng: 78.096, flowers: ['Jasmine', 'Crossandra', 'Chrysanthemum'] },
  { en: 'Thirumangalam', ta: 'திருமங்கலம்', lat: 9.822, lng: 77.989, flowers: ['Jasmine', 'Marigold', 'Rose'] },
  { en: 'Denkanikottai', ta: 'தேன்கனிக்கோட்டை', lat: 12.530, lng: 77.790, flowers: ['Rose', 'Chrysanthemum', 'Marigold'] },
  { en: 'Andipatti', ta: 'ஆண்டிபட்டி', lat: 9.999, lng: 77.622, flowers: ['Jasmine', 'Marigold', 'Crossandra'] },
  { en: 'Attur', ta: 'ஆத்தூர்', lat: 11.597, lng: 78.598, flowers: ['Tuberose', 'Marigold', 'Chrysanthemum'] },
  { en: 'Musiri', ta: 'முசிறி', lat: 10.952, lng: 78.444, flowers: ['Lotus', 'Jasmine', 'Crossandra'] }
];

// Given names and family/father names in both scripts; combined they give 2,000+ distinct farmers
const GIVEN = [
  ['Murugan', 'முருகன்'], ['Palanisamy', 'பழனிசாமி'], ['Selvam', 'செல்வம்'], ['Lakshmi', 'லட்சுமி'],
  ['Kannan', 'கண்ணன்'], ['Muthulakshmi', 'முத்துலட்சுமி'], ['Ramasamy', 'ராமசாமி'], ['Senthil', 'செந்தில்'],
  ['Valli', 'வள்ளி'], ['Arumugam', 'ஆறுமுகம்'], ['Pandian', 'பாண்டியன்'], ['Saroja', 'சரோஜா'],
  ['Ganesan', 'கணேசன்'], ['Meena', 'மீனா'], ['Karuppasamy', 'கருப்பசாமி'], ['Thangam', 'தங்கம்'],
  ['Velmurugan', 'வேல்முருகன்'], ['Chinnasamy', 'சின்னசாமி'], ['Kalaiselvi', 'கலைச்செல்வி'], ['Rajendran', 'ராஜேந்திரன்'],
  ['Subramani', 'சுப்பிரமணி'], ['Pushpa', 'புஷ்பா'], ['Mariappan', 'மாரியப்பன்'], ['Jeyakumar', 'ஜெயக்குமார்'],
  ['Ponnusamy', 'பொன்னுசாமி'], ['Amutha', 'அமுதா'], ['Sivakumar', 'சிவக்குமார்'], ['Rani', 'ராணி'],
  ['Duraisamy', 'துரைசாமி'], ['Malarkodi', 'மலர்க்கொடி'], ['Kumaresan', 'குமரேசன்'], ['Anbuselvan', 'அன்புச்செல்வன்'],
  ['Perumal', 'பெருமாள்'], ['Selvi', 'செல்வி'], ['Murugesan', 'முருகேசன்'], ['Nagarajan', 'நாகராஜன்'],
  ['Vasanthi', 'வசந்தி'], ['Elangovan', 'இளங்கோவன்'], ['Shanthi', 'சாந்தி'], ['Gopal', 'கோபால்'],
  ['Sundari', 'சுந்தரி'], ['Manikandan', 'மணிகண்டன்'], ['Revathi', 'ரேவதி'], ['Saravanan', 'சரவணன்'],
  ['Kavitha', 'கவிதா'], ['Balamurugan', 'பாலமுருகன்'], ['Deepa', 'தீபா'], ['Prakash', 'பிரகாஷ்'],
  ['Jothi', 'ஜோதி'], ['Raja', 'ராஜா']
];
const FAMILY = [
  ['Velu', 'வேலு'], ['Gounder', 'கவுண்டர்'], ['Raju', 'ராஜு'], ['Ammal', 'அம்மாள்'], ['Periyasamy', 'பெரியசாமி'],
  ['Ganesan', 'கணேசன்'], ['Thevar', 'தேவர்'], ['Kumar', 'குமார்'], ['Murugesan', 'முருகேசன்'], ['Pillai', 'பிள்ளை'],
  ['Sekar', 'சேகர்'], ['Devi', 'தேவி'], ['Muthu', 'முத்து'], ['Kumari', 'குமாரி'], ['Ayyanar', 'அய்யனார்'],
  ['Rajan', 'ராஜன்'], ['Naicker', 'நாயக்கர்'], ['Anbu', 'அன்பு'], ['Mani', 'மணி'], ['Kandasamy', 'கந்தசாமி'],
  ['Sundaram', 'சுந்தரம்'], ['Paul', 'பால்'], ['Velayutham', 'வேலாயுதம்'], ['Ravi', 'ரவி'], ['Natarajan', 'நடராஜன்'],
  ['Mariammal', 'மாரியம்மாள்'], ['Krishnan', 'கிருஷ்ணன்'], ['Selvaraj', 'செல்வராஜ்'], ['Bala', 'பாலா'], ['Moorthy', 'மூர்த்தி'],
  ['Ayyakannu', 'அய்யாக்கண்ணு'], ['Pandiyan', 'பாண்டியன்'], ['Kali', 'காளி'], ['Thangavel', 'தங்கவேல்'], ['Sivam', 'சிவம்'],
  ['Ramesh', 'ரமேஷ்'], ['Arumugam', 'ஆறுமுகம்'], ['Chelladurai', 'செல்லதுரை'], ['Govindan', 'கோவிந்தன்'], ['Subbiah', 'சுப்பையா'],
  ['Karthikeyan', 'கார்த்திகேயன்'], ['Muniyandi', 'முனியாண்டி'], ['Shanmugam', 'சண்முகம்'], ['Rathinam', 'ரத்தினம்'], ['Venkatesan', 'வெங்கடேசன்']
];

function farmerNames(count) {
  const pairs = [];
  for (const g of GIVEN) for (const f of FAMILY) if (g[0] !== f[0]) pairs.push([`${g[0]} ${f[0]}`, `${g[1]} ${f[1]}`]);
  for (let i = pairs.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pairs[i], pairs[j]] = [pairs[j], pairs[i]];
  }
  return pairs.slice(0, count);
}

// Wholesale price per kg (₹), typical delivery size (kg) and rounding step
const FLOWER_MARKET = {
  Jasmine: { base: 450, kg: [4, 25], step: 10 },
  Rose: { base: 120, kg: [10, 45], step: 5 },
  Marigold: { base: 55, kg: [20, 90], step: 5 },
  Chrysanthemum: { base: 90, kg: [15, 60], step: 5 },
  Crossandra: { base: 520, kg: [2, 12], step: 10 },
  Tuberose: { base: 160, kg: [8, 35], step: 5 },
  Lotus: { base: 140, kg: [5, 20], step: 5 },
  Lily: { base: 220, kg: [5, 20], step: 10 }
};

// Approximate 2026 festival weeks, when flower prices jump
const FESTIVAL_SPIKES = [
  ['2026-08-01', '2026-08-03', 1.3], // Aadi Perukku
  ['2026-08-26', '2026-08-28', 1.35], // Varalakshmi Vratham
  ['2026-09-12', '2026-09-14', 1.4], // Vinayagar Chathurthi
  ['2026-10-12', '2026-10-20', 1.6] // Navarathri, Ayudha Pooja
];

const dailyPrices = new Map();
function priceOn(flower, date) {
  const key = `${flower}:${date}`;
  if (!dailyPrices.has(key)) {
    const { base, step } = FLOWER_MARKET[flower];
    const day = daysBetween('2026-01-01', date);
    const wave = 1 + 0.12 * Math.sin(day / 5 + flower.length);
    const spike = FESTIVAL_SPIKES.find(([from, to]) => date >= from && date <= to);
    const price = base * wave * (spike ? spike[2] : 1) * between(0.95, 1.05);
    dailyPrices.set(key, Math.max(step, Math.round(price / step) * step));
  }
  return dailyPrices.get(key);
}

function istTimestamp(date, hour, minute) {
  return new Date(`${date}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+05:30`).toISOString();
}

function clearFarmers(whereSql) {
  const ids = db.query(`SELECT id FROM farmers ${whereSql}`).map(r => r.id);
  for (const id of ids) {
    db.run('DELETE FROM farmer_locations WHERE farmer_id = ?', [id]);
    db.run('DELETE FROM collections WHERE farmer_id = ?', [id]);
    db.run('DELETE FROM farmers WHERE id = ?', [id]);
  }
  return ids.length;
}

function seed() {
  const today = localDate();
  const historyStart = addDays(today, -(DAYS_OF_HISTORY - 1));
  const currentKey = fortnightKey(today);
  const nowIso = new Date().toISOString();
  const admin = db.queryOne("SELECT full_name FROM users WHERE role = 'admin' ORDER BY id LIMIT 1");
  const actor = admin ? admin.full_name : 'System Administrator';

  // Every fortnight that overlaps the history window, oldest first
  const fortnights = lastFortnights(today, Math.ceil(DAYS_OF_HISTORY / 15) + 2).filter(k => fortnightRange(k).end >= historyStart);

  const firstFarmerNum = Math.max(1000, db.queryOne("SELECT MAX(CAST(SUBSTR(id, 5) AS INTEGER)) AS n FROM farmers WHERE id LIKE 'FAR-%'").n || 0) + 1;
  const collectionCounters = {};
  const nextCollectionId = date => {
    const year = date.slice(0, 4);
    if (!collectionCounters[year]) {
      const row = db.queryOne('SELECT MAX(CAST(SUBSTR(id, 10) AS INTEGER)) AS n FROM collections WHERE id LIKE ?', [`COL-${year}-%`]);
      collectionCounters[year] = Math.max(1000, row.n || 0);
    }
    collectionCounters[year] += 1;
    return `COL-${year}-${collectionCounters[year]}`;
  };

  let collectionCount = 0;
  let checkCount = 0;
  const names = farmerNames(FARMER_COUNT);

  names.forEach(([nameEn, nameTa], i) => {
    const village = VILLAGES[i % VILLAGES.length];
    const id = `FAR-${firstFarmerNum + i}`;
    // About 5% joined in the last two months; the rest earlier
    const joinedRecently = rand() < 0.05;
    const registeredOn = addDays(today, -(joinedRecently ? Math.floor(between(3, 60)) : DAYS_OF_HISTORY + 60));
    const createdAt = istTimestamp(registeredOn, 10, 0);
    const phone = `9${700000000 + i * 104729}`; // unique 10-digit numbers for up to 2,000 farmers
    const home = { lat: village.lat + between(-0.05, 0.05), lng: village.lng + between(-0.05, 0.05) };
    const flowers = village.flowers.filter(() => rand() < 0.6);
    if (flowers.length === 0) flowers.push(village.flowers[0]);
    const deliveryRate = between(0.3, 0.5);
    const payMode = pick(['Cash', 'Cash', 'UPI', 'Bank Transfer']);
    const noGps = rand() < 0.025;

    db.run(`
      INSERT INTO farmers (
        id, full_name, name_ta, contact_number, address, village, village_ta,
        latitude, longitude, status, notes, total_collected_kg, total_payout,
        location_review_status, is_synthetic, created_at, updated_at
      ) VALUES (?, ?, ?, ?, '', ?, ?, NULL, NULL, 'active', ?, 0, 0, 'unavailable', 1, ?, ?)
    `, [id, nameEn, nameTa, phone, village.en, village.ta, `Grows ${flowers.join(', ')}`, createdAt, nowIso]);

    // Purchases: a delivery roughly every 2-3 days, early morning
    for (let date = registeredOn > historyStart ? registeredOn : historyStart; date <= today; date = addDays(date, 1)) {
      if (rand() > deliveryRate) continue;
      const flower = pick(flowers);
      const [minKg, maxKg] = FLOWER_MARKET[flower].kg;
      const qty = Math.round(between(minKg, maxKg) * 2) / 2;
      const rate = priceOn(flower, date);
      const total = Math.round(qty * rate * 100) / 100;
      const settled = fortnightKey(date) < currentKey;
      const createdTs = istTimestamp(date, 4 + Math.floor(rand() * 4), Math.floor(rand() * 60));
      db.run(`
        INSERT INTO collections (
          id, farmer_id, farmer_name, farmer_village, collection_date, flower_type, variety,
          quantity_kg, rate_per_kg, total_amount, quality_grade, payment_status, payment_mode,
          amount_paid, status, notes, collected_by, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'Local', ?, ?, ?, 'Grade A', ?, ?, ?, 'completed', '', ?, ?, ?)
      `, [
        nextCollectionId(date), id, nameEn, village.en, date, flower,
        qty, rate, total, settled ? 'Paid' : 'Pending', payMode, settled ? total : 0,
        actor, createdTs, createdTs
      ]);
      collectionCount++;
    }

    if (noGps) return;

    // Location checks: coverage improves from ~55% to ~85% of farmers per fortnight;
    // the current fortnight is only partly over, so fewer checks so far.
    let last = null;
    const addCheck = (date, source) => {
      const lat = home.lat + between(-0.0005, 0.0005);
      const lng = home.lng + between(-0.0005, 0.0005);
      const ts = istTimestamp(date, 7 + Math.floor(rand() * 4), Math.floor(rand() * 60));
      db.run(`
        INSERT INTO farmer_locations (
          farmer_id, latitude, longitude, village, address, source, verification_status,
          verified_by, capture_timestamp, review_notes, created_at
        ) VALUES (?, ?, ?, ?, '', ?, 'verified', ?, ?, '15-day location check', ?)
      `, [id, lat, lng, village.en, source, actor, ts, ts]);
      last = { date, lat, lng };
      checkCount++;
    };

    addCheck(registeredOn, 'Admin Verified Registration');
    fortnights.forEach((key, n) => {
      const { start, end } = fortnightRange(key);
      const from = [start, registeredOn, historyStart].sort().pop();
      const to = end < today ? end : today;
      if (from > to || (last && last.date >= from)) return;
      const elapsed = (daysBetween(start, to) + 1) / (daysBetween(start, end) + 1);
      const chance = (0.55 + 0.3 * (n / Math.max(1, fortnights.length - 1))) * elapsed;
      if (rand() < chance) {
        addCheck(addDays(from, Math.floor(rand() * (daysBetween(from, to) + 1))), pick(['Field Visit Collection', 'Admin Verified Update']));
      }
    });

    db.run(
      'UPDATE farmers SET latitude = ?, longitude = ?, last_location_reviewed_at = ? WHERE id = ?',
      [last.lat, last.lng, last.date, id]
    );
  });

  // Farmer totals derived from their purchases
  db.run(`
    UPDATE farmers SET
      total_collected_kg = (SELECT ROUND(COALESCE(SUM(quantity_kg), 0), 2) FROM collections c WHERE c.farmer_id = farmers.id AND c.status = 'completed'),
      total_payout = (SELECT ROUND(COALESCE(SUM(total_amount), 0), 2) FROM collections c WHERE c.farmer_id = farmers.id AND c.status = 'completed'),
      last_collection_date = (SELECT MAX(collection_date) FROM collections c WHERE c.farmer_id = farmers.id AND c.status = 'completed')
    WHERE is_synthetic = 1
  `);

  db.logAudit('SYSTEM', 'Demo Seeder', 'DEMO_DATA_SEEDED', 'system', null,
    `Seeded ${names.length} synthetic farmers, ${collectionCount} purchases and ${checkCount} location checks over ${DAYS_OF_HISTORY} days`);

  return { farmers: names.length, collections: collectionCount, checks: checkCount, days: DAYS_OF_HISTORY };
}

(async () => {
  await db.initDatabase();
  const started = Date.now();

  const result = db.transaction(() => {
    const removed = flag('--fresh') ? clearFarmers('') : clearFarmers('WHERE is_synthetic = 1');
    if (flag('--clear')) return { removed };
    return { removed, ...seed() };
  });

  db.refreshLocationReviewStatuses(true);
  db.closeDatabase();
  console.log(`[Seed] ${db.DB_FILE} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  console.log('[Seed]', result);
})().catch(err => {
  console.error('[Seed] Failed:', err);
  process.exit(1);
});
