/* =========================================================
   FRESH BLOOMS - ENTERPRISE ADMIN CONTROLLER
   Professional Admin Dashboard & Secure Farmer Management
   ========================================================= */

// Global Application State
const state = {
  token: localStorage.getItem('fb_admin_token') || null,
  user: JSON.parse(localStorage.getItem('fb_admin_user') || 'null'),
  lang: localStorage.getItem('fb_lang') || 'en',
  currentView: 'dashboard',
  farmers: [],
  villages: [],
  dashboardStats: null,
  mapInstance: null,
  mapMarkers: [],
  mappedFarmers: [],
  allFarmers: [],
  activeLocationTab: 'all',
  mapClickListenerAttached: false,
  tempMapMarker: null,
  manualEntryMode: 'existing',
  currentProfileFarmerId: null,
  farmerPagination: { page: 1, limit: 15, total: 0 },
  collectionPagination: { page: 1, limit: 15, total: 0 },
  auditPagination: { page: 1, limit: 25, total: 0 },
  syncInterval: null,
  // Selling Management & Client Billing Additions
  buyers: [],
  distributions: [],
  sellingBills: [],
  activeSellingTab: 'buyers',
  buyerPagination: { page: 1, limit: 15, total: 0 },
  distPagination: { page: 1, limit: 15, total: 0 },
  sellingBillsPagination: { page: 1, limit: 15, total: 0 },
  currentSellingBill: null,
  unbilledDistributions: [],
  selectedUnbilledIds: new Set(),
  currentFarmerStatement: null,
  currentStatementFarmerId: null
};

// Global reference for active profile modal
let currentProfileFarmerId = null;

// Bilingual English & Tamil Translation Dictionary
const i18n = {
  en: {
    brand_tag: "Administrator Portal & Farmer Operations",
    admin_sign_in: "Admin Sign In",
    sign_in_sub: "Access the central farmer collection and management console",
    username_label: "Username or Email",
    password_label: "Password",
    security_badge: "🛡️ Protected by brute-force rate limiting",
    btn_sign_in: "Sign In to Admin Console",
    nav_dashboard: "Dashboard",
    nav_farmers: "Farmers",
    nav_locations: "15-Day Locations",
    nav_collections: "Flower Collections",
    nav_reports: "Reports & Exports",
    nav_audit: "Audit Trail",
    nav_profile: "Admin Profile & Security",
    super_admin_tag: "Super Admin",
    live_sync: "Live Sync",
    btn_refresh: "🔄 Refresh",
    btn_register_farmer: "+ Register Farmer",
    btn_record_collection: "🌸 + Record Harvest Collection",
    stat_total_farmers: "Total Registered Farmers",
    stat_total_collections: "Total Flower Collections",
    stat_total_payout: "Total Farmer Payout",
    stat_location_review: "15-Day Location Review",
    verified: "Verified (<15d)",
    due_soon: "Due Soon (<3d)",
    overdue: "Overdue (>15d)",
    unavailable: "Location Unavailable",
    paid: "Paid",
    pending: "Pending",
    cancelled: "Cancelled",
    flower_jasmine: "Jasmine (Mogra)",
    flower_rose: "Rose",
    flower_marigold: "Marigold",
    flower_chrysanthemum: "Chrysanthemum",
    flower_lotus: "Lotus",
    flower_tuberose: "Tuberose",
    flower_lily: "Lily"
  },
  ta: {
    brand_tag: "நிர்வாகி தளம் & மலர் விவசாய பணிகள்",
    admin_sign_in: "நிர்வாகி உள்நுழைவு",
    sign_in_sub: "மலர் சேகரிப்பு மற்றும் விவசாய மேலாண்மை கட்டுப்பாட்டு அறை",
    username_label: "பயனர் பெயர் அல்லது மின்னஞ்சல்",
    password_label: "கடவுச்சொல்",
    security_badge: "🛡️ பாதுகாப்பான கடவுச்சொல் மற்றும் அமர்வு பாதுகாப்பு",
    btn_sign_in: "நிர்வாகி உள்நுழைய",
    nav_dashboard: "கட்டுப்பாட்டு அறை",
    nav_farmers: "விவசாயிகள் பதிவேடு",
    nav_locations: "15-நாள் இருப்பிடங்கள்",
    nav_collections: "மலர் வரவு சேகரிப்பு",
    nav_reports: "அறிக்கைகள் & ஏற்றுமதி",
    nav_audit: "தணிக்கை பதிவு",
    nav_profile: "நிர்வாகி சுயவிவரம்",
    super_admin_tag: "தலைமை நிர்வாகி",
    live_sync: "நேரலை தரவு",
    btn_refresh: "🔄 புதுப்பி",
    btn_register_farmer: "+ விவசாயி பதிவு",
    btn_record_collection: "🌸 + மலர் சேகரிப்பு பதிவு",
    stat_total_farmers: "பதிவுசெய்த விவசாயிகள்",
    stat_total_collections: "மொத்த மலர் சேகரிப்புகள்",
    stat_total_payout: "மொத்த பட்டுவாடா தொகை",
    stat_location_review: "15-நாள் இருப்பிட மதிப்பாய்வு",
    verified: "சரிபார்க்கப்பட்டது (<15 நாள்)",
    due_soon: "விரைவில் மதிப்பாய்வு (<3 நாள்)",
    overdue: "மதிப்பாய்வு தாமதமானது (>15 நாள்)",
    unavailable: "இருப்பிடம் இல்லை",
    paid: "வழங்கப்பட்டது",
    pending: "நிலுவையில் உள்ளது",
    cancelled: "ரத்து செய்யப்பட்டது",
    flower_jasmine: "மல்லிகை (மொட்டு)",
    flower_rose: "ரோஜா",
    flower_marigold: "சாமந்தி",
    flower_chrysanthemum: "செவ்வந்தி",
    flower_lotus: "தாமரை",
    flower_tuberose: "சம்பங்கி",
    flower_lily: "அல்லி"
  }
};

function t(key, fallback = '') {
  const dict = i18n[state.lang] || i18n.en;
  return dict[key] !== undefined ? dict[key] : (fallback || key);
}

function setLanguage(lang) {
  state.lang = lang;
  localStorage.setItem('fb_lang', lang);

  // Update pills active status
  ['login-lang-en', 'nav-lang-en'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (lang === 'en') el.classList.add('active');
      else el.classList.remove('active');
    }
  });
  ['login-lang-ta', 'nav-lang-ta'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (lang === 'ta') el.classList.add('active');
      else el.classList.remove('active');
    }
  });

  // Apply translations to all DOM elements with data-i18n
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    const trans = t(key);
    if (trans) el.textContent = trans;
  });

  // Refresh current view table data to apply Tamil/English badges
  if (state.token) {
    loadCurrentViewData();
  }
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setLanguage(state.lang);
  initAdminApp();
});

function initAdminApp() {
  if (state.token && state.user) {
    showWorkspace();
    setupAdminInterface();
    loadCurrentViewData();
    startLiveSync();
  } else {
    showLogin();
  }
}

// =========================================================
// 1. AUTHENTICATION & SESSION
// =========================================================
const loginForm = document.getElementById('admin-login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-login-submit');

    btn.disabled = true;
    btn.innerHTML = `<span>Verifying credentials...</span>`;

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed.');

      state.token = data.token;
      state.user = data.user;
      localStorage.setItem('fb_admin_token', data.token);
      localStorage.setItem('fb_admin_user', JSON.stringify(data.user));

      showToast(`Welcome, ${data.user.full_name}! Administrator session active.`, 'success');
      showWorkspace();
      setupAdminInterface();
      loadCurrentViewData();
      startLiveSync();
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span>Sign In to Admin Console</span> <span class="btn-arrow">→</span>`;
    }
  });
}

// Password Visibility Toggle
const btnTogglePw = document.getElementById('btn-toggle-pw');
if (btnTogglePw) {
  btnTogglePw.addEventListener('click', () => {
    const pwInput = document.getElementById('login-password');
    if (pwInput.type === 'password') {
      pwInput.type = 'text';
      btnTogglePw.textContent = '🔒';
    } else {
      pwInput.type = 'password';
      btnTogglePw.textContent = '👁️';
    }
  });
}

function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-workspace').classList.add('hidden');
  if (state.syncInterval) clearInterval(state.syncInterval);
}

function showWorkspace() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-workspace').classList.remove('hidden');
}

function setupAdminInterface() {
  if (!state.user) return;
  document.getElementById('sidebar-admin-name').textContent = state.user.full_name;
  document.getElementById('sidebar-admin-avatar').textContent = (state.user.full_name || 'A').charAt(0).toUpperCase();

  // Profile view details
  const profName = document.getElementById('profile-full-name');
  if (profName) profName.textContent = state.user.full_name;
  const profUser = document.getElementById('profile-username');
  if (profUser) profUser.textContent = state.user.username;
  const profEmail = document.getElementById('profile-email');
  if (profEmail) profEmail.textContent = state.user.email || '—';
  const profLastLogin = document.getElementById('profile-last-login');
  if (profLastLogin) profLastLogin.textContent = state.user.last_login_at ? formatDate(state.user.last_login_at) : 'First login';
}

async function handleLogout() {
  try {
    await authFetch('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    // Continue client cleanup even if request fails
  }
  state.token = null;
  state.user = null;
  localStorage.removeItem('fb_admin_token');
  localStorage.removeItem('fb_admin_user');
  showLogin();
  showToast('Administrator signed out securely.', 'info');
}

// Change Admin Password
async function handleChangePassword(e) {
  e.preventDefault();
  const currentPassword = document.getElementById('pw-current').value;
  const newPassword = document.getElementById('pw-new').value;
  const confirmPassword = document.getElementById('pw-confirm').value;

  if (newPassword !== confirmPassword) {
    showToast('New passwords do not match.', 'warn');
    return;
  }
  if (newPassword.length < 8) {
    showToast('Password must be at least 8 characters.', 'warn');
    return;
  }

  const btn = document.getElementById('btn-change-pw');
  btn.disabled = true;

  try {
    const res = await authFetch('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword, newPassword })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Administrator password updated successfully.', 'success');
    document.getElementById('change-password-form').reset();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// Background Live Sync (Every 30 seconds)
function startLiveSync() {
  if (state.syncInterval) clearInterval(state.syncInterval);
  state.syncInterval = setInterval(() => {
    if (state.currentView === 'dashboard') fetchDashboardStats(false);
  }, 30000);
}

// =========================================================
// 2. NAVIGATION & ROUTING
// =========================================================
function navigateTo(viewId) {
  state.currentView = viewId;

  // Sidebar buttons active state
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    if (item.dataset.view === viewId) item.classList.add('active');
    else item.classList.remove('active');
  });

  // App views visibility
  document.querySelectorAll('.app-view').forEach(view => {
    if (view.id === `view-${viewId}`) view.classList.remove('hidden');
    else view.classList.add('hidden');
  });

  // Mobile sidebar close
  document.getElementById('app-sidebar').classList.remove('mobile-open');

  loadCurrentViewData();
}

function toggleSidebar() {
  document.getElementById('app-sidebar').classList.toggle('mobile-open');
}

function refreshCurrentView() {
  loadCurrentViewData();
  showToast('Data refreshed from database.', 'info');
}

function loadCurrentViewData() {
  const v = state.currentView;
  if (v === 'dashboard') fetchDashboardStats(true);
  else if (v === 'farmers') fetchFarmersList();
  else if (v === 'selling') loadSellingData();
  else if (v === 'locations') initLocationsMapView();
  else if (v === 'collections') fetchCollectionsList();
  else if (v === 'reports') fetchReportsData();
  else if (v === 'audit') fetchAuditLogs();
  else if (v === 'profile') setupAdminInterface();
}

// Global Quick Search
function handleGlobalSearch(term) {
  if (!term || term.trim() === '') return;
  term = term.trim();
  if (state.currentView !== 'farmers') {
    navigateTo('farmers');
  }
  const searchInput = document.getElementById('farmer-search-input');
  if (searchInput) {
    searchInput.value = term;
    fetchFarmersList();
  }
}

// =========================================================
// 3. DASHBOARD (REAL DATABASE METRICS ONLY)
// =========================================================
async function fetchDashboardStats(showLoader = true) {
  try {
    const res = await authFetch('/api/dashboard/stats');
    if (!res.ok) {
      if (res.status === 401) { handleLogout(); return; }
      return;
    }
    const data = await res.json();
    state.dashboardStats = data;

    // 4 Summary Metrics
    document.getElementById('dash-total-farmers').textContent = data.totalFarmers.toLocaleString('en-IN');
    document.getElementById('dash-active-farmers').textContent = `${data.activeFarmers} active farmers`;
    document.getElementById('dash-total-collections').textContent = data.totalCollections.toLocaleString('en-IN');
    document.getElementById('dash-total-kg').textContent = `${data.totalQuantityKg.toLocaleString('en-IN')} kg total volume`;
    document.getElementById('dash-total-payout').textContent = `₹${data.totalPayout.toLocaleString('en-IN')}`;
    document.getElementById('dash-pending-payout').textContent = `₹${data.pendingPayout.toLocaleString('en-IN')} pending payout`;

    // 15-Day Location Review Metrics
    const dueCount = data.locationStats.totalDueOrOverdue;
    document.getElementById('dash-location-due-count').textContent = dueCount;
    document.getElementById('dash-location-status-breakdown').textContent =
      `${data.locationStats.verified} verified • ${dueCount} due or overdue`;

    // Sidebar & Top Nav Badges
    document.getElementById('nav-farmer-count').textContent = data.totalFarmers;
    const navDueBadge = document.getElementById('nav-location-due-badge');
    const topDueChip = document.getElementById('top-location-due-chip');

    if (dueCount > 0) {
      navDueBadge.textContent = `${dueCount} Due`;
      navDueBadge.classList.remove('hidden');
      document.getElementById('top-location-due-text').textContent = `${dueCount} Reviews Due`;
      topDueChip.classList.remove('hidden');

      // Alert banner on dashboard
      const banner = document.getElementById('dashboard-location-alert-banner');
      banner.classList.remove('hidden');
      document.getElementById('alert-banner-title').textContent = `${dueCount} Farmer Locations Due for 15-Day Review`;
      document.getElementById('alert-banner-desc').textContent =
        `There are ${data.locationStats.overdue} overdue and ${data.locationStats.dueSoon} due-soon farmer location records that require verification.`;
    } else {
      navDueBadge.classList.add('hidden');
      topDueChip.classList.add('hidden');
      document.getElementById('dashboard-location-alert-banner').classList.add('hidden');
    }

    // Render Recent Collections Table (or Empty State)
    renderDashboardRecentCollections(data.recentCollections);

    // Render Flower Breakdown List (or Empty State)
    renderDashboardFlowerBreakdown(data.flowerTypeBreakdown);

    // Render Audit Stream
    renderDashboardAuditStream(data.recentAuditLogs);

  } catch (err) {
    console.error('Failed to fetch dashboard stats:', err);
  }
}

function renderDashboardRecentCollections(collections) {
  const container = document.getElementById('dash-collections-table-wrap');
  if (!container) return;

  if (!collections || collections.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box">
        <div class="empty-icon">🧺</div>
        <h4>No Harvest Collections Recorded Yet</h4>
        <p>No flower collections have been logged in the system. Use the button below to record the first intake from a registered farmer.</p>
        <button class="btn btn-primary btn-sm" onclick="openNewCollectionModal()">
          <span>🌸 Record First Collection</span>
        </button>
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <table class="table">
      <thead>
        <tr>
          <th>Collection ID</th>
          <th>Farmer</th>
          <th>Village</th>
          <th>Flower</th>
          <th>Weight</th>
          <th>Total</th>
          <th>Payment</th>
        </tr>
      </thead>
      <tbody>
        ${collections.map(c => `
          <tr>
            <td><span class="badge-code">${c.id}</span></td>
            <td><strong>${escapeHtml(c.farmer_name)}</strong></td>
            <td>${escapeHtml(c.farmer_village)}</td>
            <td>${escapeHtml(c.flower_type)}</td>
            <td><strong>${c.quantity_kg} kg</strong></td>
            <td><strong>₹${c.total_amount.toLocaleString('en-IN')}</strong></td>
            <td><span class="badge-tag ${c.payment_status.toLowerCase()}">${c.payment_status}</span></td>
          </tr>
        `).join('')}
      </tbody>
    </table>
  `;
}

function renderDashboardFlowerBreakdown(breakdown) {
  const container = document.getElementById('dash-flower-breakdown-list');
  if (!container) return;

  if (!breakdown || breakdown.length === 0) {
    container.innerHTML = `
      <div class="empty-state-box" style="padding: 24px;">
        <p style="margin: 0; font-size: 0.82rem; color: #64748B;">No flower intake recorded yet.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = breakdown.map(f => `
    <div class="summary-list-item">
      <div>
        <strong>${escapeHtml(f.flower_type)}</strong>
        <div style="font-size: 0.75rem; color: #64748B;">${f.record_count} collection batch(es)</div>
      </div>
      <div style="text-align: right;">
        <strong>${f.total_kg} kg</strong>
        <div style="font-size: 0.75rem; color: #15803D;">₹${f.total_amount.toLocaleString('en-IN')}</div>
      </div>
    </div>
  `).join('');
}

function renderDashboardAuditStream(logs) {
  const container = document.getElementById('dash-audit-stream-list');
  if (!container) return;

  if (!logs || logs.length === 0) {
    container.innerHTML = `<p style="font-size: 0.82rem; color: #64748B; padding: 12px;">No recent audit activity.</p>`;
    return;
  }

  container.innerHTML = logs.map(l => `
    <div class="audit-stream-item">
      <div class="audit-time">${formatDate(l.timestamp)} • ${escapeHtml(l.actor_name)}</div>
      <div class="audit-text">${escapeHtml(l.details)}</div>
    </div>
  `).join('');
}

// =========================================================
// 4. FARMERS MANAGEMENT
// =========================================================
async function fetchFarmersList() {
  const search = document.getElementById('farmer-search-input')?.value || '';
  const village = document.getElementById('farmer-village-filter')?.value || '';
  const reviewStatus = document.getElementById('farmer-review-filter')?.value || '';
  const page = state.farmerPagination?.page || 1;
  const limit = state.farmerPagination?.limit || 15;

  try {
    const res = await authFetch(`/api/farmers?search=${encodeURIComponent(search)}&village=${encodeURIComponent(village)}&reviewStatus=${encodeURIComponent(reviewStatus)}&page=${page}&limit=${limit}`);
    if (!res.ok) return;

    const data = await res.json();
    state.farmers = data.farmers || [];
    state.villages = data.villages || [];
    state.farmerPagination = data.pagination || { page: 1, limit: 15, total: 0, totalPages: 0 };

    // Update village filter dropdown options safely
    updateVillageFilterDropdown(state.villages);

    // Records counter
    const counter = document.getElementById('farmers-records-counter');
    if (counter) {
      counter.textContent = `${state.farmerPagination.total} registered farmers`;
    }

    renderFarmersTable(state.farmers);
    renderPaginationControls('farmers-pagination', state.farmerPagination, (p) => {
      state.farmerPagination.page = p;
      fetchFarmersList();
    });

  } catch (err) {
    console.error('Failed to fetch farmers list:', err);
  }
}

function updateVillageFilterDropdown(villages) {
  const select = document.getElementById('farmer-village-filter');
  if (!select) return;
  const list = Array.isArray(villages) ? villages : [];
  const currentVal = select.value;
  select.innerHTML = '<option value="">All Villages</option>' +
    list.map(v => `<option value="${escapeHtml(v)}" ${v === currentVal ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
}

function onFarmerSearchChange(val) {
  state.farmerPagination.page = 1;
  fetchFarmersList();
}

function onFarmerFilterChange() {
  state.farmerPagination.page = 1;
  fetchFarmersList();
}

function renderFarmersTable(farmers) {
  const tbody = document.getElementById('farmers-table-tbody');
  if (!tbody) return;

  if (!farmers || farmers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9">
          <div class="empty-state-box">
            <div class="empty-icon">👨‍🌾</div>
            <h4>${t('empty_farmers_title', 'No Farmers Found in Registry')}</h4>
            <p>${t('empty_farmers_desc', 'No farmers registered in the system yet. Register your first flower farmer to begin.')}</p>
            <button class="btn btn-primary btn-sm" onclick="openNewFarmerModal()">
              <span>${t('btn_register_farmer', '+ Register New Farmer')}</span>
            </button>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = farmers.map(f => {
    const locStatus = f.location_review_status || 'unavailable';
    const locStatusLabel = t(locStatus, locStatus);

    const btnProfile = state.lang === 'ta' ? '👤 சுயவிவரம்' : '👤 Profile';
    const btnLoc = state.lang === 'ta' ? '📍 இருப்பிடம்' : '📍 Location';
    const btnHarvest = state.lang === 'ta' ? '🌸 வரவு' : '🌸 Harvest';

    const totalKg = Number(f.total_collected_kg || 0).toLocaleString('en-IN');
    const totalPayout = Number(f.total_payout || 0).toLocaleString('en-IN');

    return `
      <tr>
        <td><span class="badge-code">${escapeHtml(f.id)}</span></td>
        <td>
          <strong>${escapeHtml(f.full_name)}</strong>
          ${f.name_ta ? `<br><small class="text-subtle">${escapeHtml(f.name_ta)}</small>` : ''}
          <div style="font-size: 0.72rem; color: #475569; margin-top: 2px;">
            <span class="badge-tag info" style="font-size: 0.68rem; padding: 1px 5px;">${f.billing_cycle_days || 15}d Cycle</span>
            <span class="badge-tag" style="font-size: 0.68rem; padding: 1px 5px; background: #EEF2FF; color: #4F46E5;">${f.commission_rate ?? 10}% Comm</span>
          </div>
        </td>
        <td>${escapeHtml(f.contact_number)}</td>
        <td>${escapeHtml(f.village)}</td>
        <td><span class="badge-tag ${locStatus}">${escapeHtml(locStatusLabel)}</span></td>
        <td><strong>${totalKg} kg</strong></td>
        <td><strong>₹${totalPayout}</strong></td>
        <td>${escapeHtml(f.last_collection_date || '—')}</td>
        <td>
          <div style="display: flex; gap: 4px; flex-wrap: wrap;">
            <button class="btn btn-outline btn-xs" onclick="openFarmerProfileModal('${escapeHtml(f.id)}')" title="View Full Profile">${btnProfile}</button>
            <button class="btn btn-outline btn-xs" onclick="openFarmerStatementModal('${escapeHtml(f.id)}')" title="View 15/20/30-Day Statement">📑 Statement</button>
            <button class="btn btn-outline btn-xs" onclick="openLocationReviewForFarmer('${escapeHtml(f.id)}')" title="Review 15-Day Location">${btnLoc}</button>
            <button class="btn btn-primary btn-xs" onclick="startCollectionForFarmer('${escapeHtml(f.id)}')" title="Record Flower Harvest">${btnHarvest}</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// Modal: Register Farmer
function openNewFarmerModal() {
  const form = document.getElementById('new-farmer-form');
  if (form) form.reset();
  const cycleSelect = document.getElementById('farmer-billing-cycle');
  if (cycleSelect) cycleSelect.value = '15';
  const commInput = document.getElementById('farmer-commission-rate');
  if (commInput) commInput.value = '10';
  document.getElementById('new-farmer-modal')?.classList.remove('hidden');
}

function closeNewFarmerModal() {
  document.getElementById('new-farmer-modal')?.classList.add('hidden');
}

async function handleCreateFarmer(e) {
  e.preventDefault();
  const full_name = document.getElementById('farmer-name').value.trim();
  const name_ta = document.getElementById('farmer-name-ta')?.value.trim() || '';
  const contact_number = document.getElementById('farmer-contact').value.trim();
  const village = document.getElementById('farmer-village').value.trim();
  const address = document.getElementById('farmer-address').value.trim();
  const latitude = document.getElementById('farmer-lat').value.trim();
  const longitude = document.getElementById('farmer-lng').value.trim();
  const notes = document.getElementById('farmer-notes').value.trim();
  const billing_cycle_days = parseInt(document.getElementById('farmer-billing-cycle')?.value) || 15;
  const commission_rate = parseFloat(document.getElementById('farmer-commission-rate')?.value) || 10.0;

  // Validate latitude / longitude if partially entered
  if ((latitude && !longitude) || (!latitude && longitude)) {
    showToast('Please provide both latitude and longitude, or leave both empty.', 'warn');
    return;
  }

  const btn = document.getElementById('btn-save-farmer');
  if (btn) btn.disabled = true;

  try {
    const res = await authFetch('/api/farmers', {
      method: 'POST',
      body: JSON.stringify({
        full_name,
        name_ta,
        contact_number,
        village,
        address,
        latitude,
        longitude,
        notes,
        billing_cycle_days,
        commission_rate
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to register farmer');

    showToast(`Farmer ${data.full_name} (${data.id}) registered successfully!`, 'success');
    closeNewFarmerModal();

    // Reset search and filters so newly registered farmer is immediately visible
    const searchInput = document.getElementById('farmer-search-input');
    if (searchInput) searchInput.value = '';
    const villageFilter = document.getElementById('farmer-village-filter');
    if (villageFilter) villageFilter.value = '';
    const reviewFilter = document.getElementById('farmer-review-filter');
    if (reviewFilter) reviewFilter.value = '';
    state.farmerPagination.page = 1;

    // Navigate to farmers view so user immediately sees their registered farmer
    if (state.currentView !== 'farmers') {
      navigateTo('farmers');
    } else {
      fetchFarmersList();
    }
    fetchDashboardStats(false);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// =========================================================
// 5. 15-DAY FARMER LOCATION REVIEW & INTERACTIVE MAP
// =========================================================
function initLocationsMapView() {
  loadMapData();
  loadAllMappedFarmersAndDue();
}

async function loadMapData() {
  const statusFilter = document.getElementById('map-filter-status')?.value || '';

  try {
    const res = await authFetch(`/api/farmers/locations/map?reviewStatus=${encodeURIComponent(statusFilter)}`);
    if (!res.ok) return;
    const data = await res.json();

    const count = data.count !== undefined ? data.count : (data.farmers || []).length;
    state.mappedFarmers = data.farmers || [];

    const countElem = document.getElementById('map-active-count');
    if (countElem) {
      countElem.textContent = `Showing ${count} mapped farmer(s) with verified GPS`;
    }

    renderLeafletMap(state.mappedFarmers);
  } catch (err) {
    console.error('Failed to load map data:', err);
  }
}

function renderLeafletMap(farmers) {
  const mapElement = document.getElementById('farmers-leaflet-map');
  if (!mapElement) return;

  // Initialize or re-use map instance
  if (!state.mapInstance) {
    state.mapInstance = L.map('farmers-leaflet-map').setView([11.1271, 78.6569], 7);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '© OpenStreetMap contributors'
    }).addTo(state.mapInstance);
  }

  // Attach map click listener for manual coordinate picking
  if (!state.mapClickListenerAttached) {
    state.mapClickListenerAttached = true;
    state.mapInstance.on('click', function(e) {
      handleMapClick(e.latlng.lat, e.latlng.lng);
    });
  }

  // Clear previous markers
  state.mapMarkers.forEach(m => m.remove());
  state.mapMarkers = [];
  if (state.tempMapMarker) {
    state.tempMapMarker.remove();
    state.tempMapMarker = null;
  }

  if (!farmers || farmers.length === 0) {
    return;
  }

  const bounds = [];

  farmers.forEach(f => {
    if (f.latitude && f.longitude) {
      const lat = parseFloat(f.latitude);
      const lng = parseFloat(f.longitude);

      bounds.push([lat, lng]);

      const locStatus = f.location_review_status || 'verified';
      const markerColor = locStatus === 'overdue' ? '#DC2626' : locStatus === 'due_soon' ? '#D97706' : '#16A34A';

      // Custom SVG marker icon with high visibility
      const customIcon = L.divIcon({
        className: 'custom-map-pin',
        html: `<div style="background-color: ${markerColor}; width: 14px; height: 14px; border-radius: 50%; border: 2px solid #FFFFFF; box-shadow: 0 2px 4px rgba(0,0,0,0.3);"></div>`,
        iconSize: [14, 14],
        iconAnchor: [7, 7]
      });

      const marker = L.marker([lat, lng], { icon: customIcon }).addTo(state.mapInstance);

      const popupHtml = `
        <div class="custom-map-popup">
          <h4>${escapeHtml(f.full_name)} (${f.id})</h4>
          ${f.name_ta ? `<p style="color: #64748B; font-size: 0.75rem;">${escapeHtml(f.name_ta)}</p>` : ''}
          <p><strong>Village:</strong> ${escapeHtml(f.village)}</p>
          <p><strong>Contact:</strong> ${escapeHtml(f.contact_number)}</p>
          <p><strong>Source:</strong> <span class="badge-tag" style="background: #EEF2F6; color: #334155;">${escapeHtml(f.location_source || 'manual')}</span></p>
          <p><strong>15-Day Status:</strong> <span class="badge-tag ${locStatus}">${locStatus.toUpperCase()}</span></p>
          <p><strong>GPS:</strong> ${lat.toFixed(5)}, ${lng.toFixed(5)}</p>
          <p><strong>Last Reviewed:</strong> ${f.last_location_reviewed_at || 'Registration'}</p>
          <p><strong>Next Due:</strong> ${f.next_location_review_due_at || '—'}</p>
          <div style="display: flex; gap: 6px; margin-top: 8px;">
            <button class="btn btn-primary btn-xs" style="flex: 1;" onclick="openManualLocationModalWithFarmer('${f.id}')">
              ✏️ Set Location
            </button>
            <button class="btn btn-outline btn-xs" style="flex: 1;" onclick="startCollectionForFarmer('${f.id}')">
              🌸 Record Intake
            </button>
          </div>
        </div>
      `;

      marker.bindPopup(popupHtml);
      marker.farmerId = f.id;
      state.mapMarkers.push(marker);
    }
  });

  if (bounds.length > 0) {
    state.mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  }

  // Invalidate size to ensure proper tile rendering inside dynamic containers
  setTimeout(() => state.mapInstance?.invalidateSize(), 200);
}

// Handle clicking anywhere on the interactive map
function handleMapClick(lat, lng) {
  const roundedLat = parseFloat(lat.toFixed(6));
  const roundedLng = parseFloat(lng.toFixed(6));

  if (state.tempMapMarker) {
    state.tempMapMarker.remove();
  }

  const tempIcon = L.divIcon({
    className: 'custom-temp-pin',
    html: `<div style="background-color: #2563EB; width: 16px; height: 16px; border-radius: 50%; border: 3px solid #FFFFFF; box-shadow: 0 0 10px rgba(37,99,235,0.8); animation: pulsePin 1.5s infinite;"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8]
  });

  state.tempMapMarker = L.marker([lat, lng], { icon: tempIcon }).addTo(state.mapInstance);

  const popupContent = `
    <div class="custom-map-popup" style="min-width: 220px;">
      <h4 style="color: #1E40AF; margin-bottom: 6px;">📍 Selected Map Location</h4>
      <p style="margin-bottom: 2px;"><strong>Lat:</strong> ${roundedLat}</p>
      <p style="margin-bottom: 8px;"><strong>Lng:</strong> ${roundedLng}</p>
      <button class="btn btn-primary btn-xs btn-block" onclick="openManualLocationModalWithCoords(${roundedLat}, ${roundedLng})">
        + Set / Add Farmer Location Here
      </button>
    </div>
  `;

  state.tempMapMarker.bindPopup(popupContent).openPopup();
}

function resetMapView() {
  if (!state.mapInstance) return;
  const bounds = [];
  state.mapMarkers.forEach(m => bounds.push(m.getLatLng()));
  if (bounds.length > 0) {
    state.mapInstance.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
  } else {
    state.mapInstance.setView([11.1271, 78.6569], 7);
  }
}

function focusFarmerOnMap(farmerId) {
  const farmer = (state.allFarmers || []).find(f => f.id === farmerId) || (state.mappedFarmers || []).find(f => f.id === farmerId);
  if (!farmer || !farmer.latitude || !farmer.longitude || !state.mapInstance) return;

  // Scroll map card into view
  const mapContainer = document.getElementById('farmers-leaflet-map');
  if (mapContainer) {
    mapContainer.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  const lat = parseFloat(farmer.latitude);
  const lng = parseFloat(farmer.longitude);

  state.mapInstance.flyTo([lat, lng], 14, { duration: 1 });

  // Open the marker popup
  setTimeout(() => {
    const marker = state.mapMarkers.find(m => m.farmerId === farmerId);
    if (marker) {
      marker.openPopup();
    }
  }, 1050);
}

// Switch between 'all' and 'due' mapped farmers table list
function switchLocationListTab(tab) {
  state.activeLocationTab = tab;

  const btnAll = document.getElementById('btn-tab-all-mapped');
  const btnDue = document.getElementById('btn-tab-due-mapped');
  const heading = document.getElementById('locations-table-heading');

  if (tab === 'all') {
    btnAll?.classList.add('btn-primary');
    btnAll?.classList.remove('btn-outline');
    btnDue?.classList.remove('btn-primary');
    btnDue?.classList.add('btn-outline');
    if (heading) heading.textContent = 'Mapped Farmers & Fortnightly Location Registry';
  } else {
    btnDue?.classList.add('btn-primary');
    btnDue?.classList.remove('btn-outline');
    btnAll?.classList.remove('btn-primary');
    btnAll?.classList.add('btn-outline');
    if (heading) heading.textContent = 'Farmers Due or Overdue for 15-Day Location Review';
  }

  renderMappedFarmersTable();
}

async function loadAllMappedFarmersAndDue() {
  try {
    const res = await authFetch('/api/farmers?limit=250');
    if (!res.ok) return;
    const data = await res.json();
    state.allFarmers = data.farmers || [];

    // Populate village filter dropdown
    const villageFilter = document.getElementById('map-farmers-village-filter');
    if (villageFilter) {
      const currentVal = villageFilter.value;
      const villages = Array.from(new Set(state.allFarmers.map(f => f.village).filter(Boolean))).sort();
      villageFilter.innerHTML = '<option value="">All Villages</option>' +
        villages.map(v => `<option value="${escapeHtml(v)}" ${v === currentVal ? 'selected' : ''}>${escapeHtml(v)}</option>`).join('');
    }

    // Populate manual location farmer select dropdown
    populateManualFarmerSelect();

    renderMappedFarmersTable();
  } catch (err) {
    console.error('Failed to load farmers for location registry:', err);
  }
}

function populateManualFarmerSelect(selectedFarmerId = null) {
  const select = document.getElementById('manual-farmer-select');
  if (!select) return;

  const farmers = (state.allFarmers || []).slice().sort((a, b) => a.full_name.localeCompare(b.full_name));
  select.innerHTML = '<option value="">-- Choose Registered Farmer --</option>' +
    farmers.map(f => {
      const hasCoords = f.latitude !== null && f.longitude !== null;
      const locLabel = hasCoords ? `[Mapped: ${parseFloat(f.latitude).toFixed(3)}, ${parseFloat(f.longitude).toFixed(3)}]` : '[No GPS]';
      return `<option value="${f.id}" ${f.id === selectedFarmerId ? 'selected' : ''}>${escapeHtml(f.full_name)} (${f.id}) - ${escapeHtml(f.village)} ${locLabel}</option>`;
    }).join('');
}

function renderMappedFarmersTable() {
  const tbody = document.getElementById('due-locations-tbody');
  if (!tbody) return;

  const searchTerm = (document.getElementById('map-farmers-search')?.value || '').trim().toLowerCase();
  const villageFilter = document.getElementById('map-farmers-village-filter')?.value || '';
  const sourceFilter = document.getElementById('map-farmers-source-filter')?.value || '';

  const allMapped = (state.allFarmers || []).filter(f => f.latitude !== null && f.longitude !== null);
  const dueFarmers = (state.allFarmers || []).filter(f =>
    f.location_review_status === 'overdue' || f.location_review_status === 'due_soon' || f.location_review_status === 'unavailable'
  );

  // Update badge counters
  const allCountElem = document.getElementById('all-mapped-count');
  if (allCountElem) allCountElem.textContent = allMapped.length;
  const dueCountElem = document.getElementById('due-mapped-count');
  if (dueCountElem) dueCountElem.textContent = dueFarmers.length;

  let list = state.activeLocationTab === 'all' ? allMapped : dueFarmers;

  // Apply filters
  if (searchTerm) {
    list = list.filter(f =>
      (f.full_name && f.full_name.toLowerCase().includes(searchTerm)) ||
      (f.id && f.id.toLowerCase().includes(searchTerm)) ||
      (f.village && f.village.toLowerCase().includes(searchTerm)) ||
      (f.contact_number && f.contact_number.includes(searchTerm))
    );
  }
  if (villageFilter) {
    list = list.filter(f => f.village === villageFilter);
  }
  if (sourceFilter) {
    list = list.filter(f => (f.location_source || '').toLowerCase().includes(sourceFilter.toLowerCase()));
  }

  const counterElem = document.getElementById('mapped-farmers-counter');
  if (counterElem) {
    counterElem.textContent = `${list.length} farmer(s) listed`;
  }

  if (list.length === 0) {
    const emptyMsg = state.activeLocationTab === 'all'
      ? 'No mapped farmers found matching criteria. Click "+ Manual Location Entry" above to add map locations.'
      : '✓ All registered farmer locations are currently up to date within the 15-day review cycle!';
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: #475569; padding: 28px; font-weight: 500;">
          ${emptyMsg}
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = list.map(f => {
    const hasGPS = f.latitude !== null && f.longitude !== null;
    const latStr = hasGPS ? parseFloat(f.latitude).toFixed(4) : null;
    const lngStr = hasGPS ? parseFloat(f.longitude).toFixed(4) : null;
    const sourceDisplay = f.location_source === 'manual' ? 'Manual Entry' : (f.location_source || 'Admin');
    const status = f.location_review_status || 'unavailable';

    return `
      <tr>
        <td>
          <strong>${escapeHtml(f.full_name)}</strong>
          <small style="color: #64748B;">(${f.id})</small>
          ${f.name_ta ? `<div style="font-size: 0.72rem; color: #94A3B8;">${escapeHtml(f.name_ta)}</div>` : ''}
        </td>
        <td>${escapeHtml(f.village)}</td>
        <td>${escapeHtml(f.contact_number)}</td>
        <td>
          ${hasGPS ? `<code style="font-size: 0.78rem; background: #EEF2F6; padding: 2px 5px; border-radius: 4px;">${latStr}, ${lngStr}</code>` : '<span style="color: #94A3B8;">No GPS</span>'}
        </td>
        <td><span class="badge-tag" style="background: #F1F5F9; color: #334155;">${escapeHtml(sourceDisplay)}</span></td>
        <td>${f.last_location_reviewed_at || 'Never'}</td>
        <td><strong>${f.next_location_review_due_at || 'Immediate'}</strong></td>
        <td><span class="badge-tag ${status}">${status.toUpperCase()}</span></td>
        <td>
          <div style="display: flex; gap: 6px;">
            ${hasGPS ? `
              <button class="btn btn-outline btn-xs" onclick="focusFarmerOnMap('${f.id}')" title="Center on Map">
                📍 Locate
              </button>
            ` : ''}
            <button class="btn btn-primary btn-xs" onclick="openManualLocationModalWithFarmer('${f.id}')" title="Set/Edit Location">
              ✏️ Set Location
            </button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// =========================================================
// MANUAL LOCATION ENTRY MODAL HANDLERS
// =========================================================
function openManualLocationModal() {
  populateManualFarmerSelect();
  setManualEntryMode('existing');
  document.getElementById('manual-location-form')?.reset();
  const sourceElem = document.getElementById('manual-source');
  if (sourceElem) sourceElem.value = 'Manual Admin Entry';
  document.getElementById('manual-location-modal')?.classList.remove('hidden');
}

function openManualLocationModalWithCoords(lat, lng) {
  openManualLocationModal();
  document.getElementById('manual-lat').value = lat;
  document.getElementById('manual-lng').value = lng;
  showToast(`Pre-filled coordinates (${lat}, ${lng}) from map click.`, 'info');
}

async function openManualLocationModalWithFarmer(farmerId) {
  openManualLocationModal();
  setManualEntryMode('existing');
  const sel = document.getElementById('manual-farmer-select');
  if (sel) sel.value = farmerId;
  onManualFarmerSelectChange(farmerId);
}

function closeManualLocationModal() {
  document.getElementById('manual-location-modal')?.classList.add('hidden');
}

function setManualEntryMode(mode) {
  state.manualEntryMode = mode;
  const btnExisting = document.getElementById('btn-manual-mode-existing');
  const btnNew = document.getElementById('btn-manual-mode-new');
  const grpExisting = document.getElementById('manual-group-existing');
  const grpNew = document.getElementById('manual-group-new');

  if (mode === 'existing') {
    if (btnExisting) {
      btnExisting.className = 'btn btn-sm btn-primary';
      btnExisting.style.background = '';
      btnExisting.style.color = '';
    }
    if (btnNew) {
      btnNew.className = 'btn btn-sm btn-outline';
      btnNew.style.background = 'transparent';
      btnNew.style.borderColor = 'transparent';
      btnNew.style.color = 'var(--text-muted)';
    }
    grpExisting?.classList.remove('hidden');
    grpNew?.classList.add('hidden');
    const sel = document.getElementById('manual-farmer-select');
    if (sel) sel.required = true;
    const nameInp = document.getElementById('manual-new-name');
    if (nameInp) nameInp.required = false;
    const phoneInp = document.getElementById('manual-new-phone');
    if (phoneInp) phoneInp.required = false;
  } else {
    if (btnNew) {
      btnNew.className = 'btn btn-sm btn-primary';
      btnNew.style.background = '';
      btnNew.style.color = '';
    }
    if (btnExisting) {
      btnExisting.className = 'btn btn-sm btn-outline';
      btnExisting.style.background = 'transparent';
      btnExisting.style.borderColor = 'transparent';
      btnExisting.style.color = 'var(--text-muted)';
    }
    grpExisting?.classList.add('hidden');
    grpNew?.classList.remove('hidden');
    const sel = document.getElementById('manual-farmer-select');
    if (sel) sel.required = false;
    const nameInp = document.getElementById('manual-new-name');
    if (nameInp) nameInp.required = true;
    const phoneInp = document.getElementById('manual-new-phone');
    if (phoneInp) phoneInp.required = true;
  }
}

function onManualFarmerSelectChange(farmerId) {
  if (!farmerId) return;
  const farmer = (state.allFarmers || []).find(f => f.id === farmerId);
  if (farmer) {
    if (farmer.village) document.getElementById('manual-village').value = farmer.village;
    if (farmer.latitude !== null && farmer.latitude !== undefined) document.getElementById('manual-lat').value = farmer.latitude;
    if (farmer.longitude !== null && farmer.longitude !== undefined) document.getElementById('manual-lng').value = farmer.longitude;
    if (farmer.address) document.getElementById('manual-address').value = farmer.address;
    if (farmer.notes) document.getElementById('manual-notes').value = farmer.notes;
  }
}

async function handleManualLocationSubmit(e) {
  e.preventDefault();
  const btn = document.getElementById('btn-save-manual-entry');
  if (btn) btn.disabled = true;

  const lat = parseFloat(document.getElementById('manual-lat').value);
  const lng = parseFloat(document.getElementById('manual-lng').value);
  const village = document.getElementById('manual-village').value.trim();
  const address = document.getElementById('manual-address').value.trim();
  const source = document.getElementById('manual-source').value;
  const notes = document.getElementById('manual-notes').value.trim();

  if (isNaN(lat) || isNaN(lng)) {
    showToast('Please provide valid decimal coordinates for latitude and longitude.', 'error');
    if (btn) btn.disabled = false;
    return;
  }

  try {
    let savedFarmerId = null;

    if (state.manualEntryMode === 'existing') {
      const farmerId = document.getElementById('manual-farmer-select').value;
      if (!farmerId) {
        showToast('Please select a farmer from the dropdown.', 'error');
        if (btn) btn.disabled = false;
        return;
      }

      const res = await authFetch(`/api/farmers/${farmerId}/location`, {
        method: 'POST',
        body: JSON.stringify({
          latitude: lat,
          longitude: lng,
          village,
          address,
          source,
          notes
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to store farmer location.');
      savedFarmerId = farmerId;
      showToast(`Location successfully stored for farmer ${data.full_name} (${farmerId})!`, 'success');
    } else {
      // Register new farmer with location
      const fullName = document.getElementById('manual-new-name').value.trim();
      const nameTa = document.getElementById('manual-new-name-ta').value.trim();
      const contactNumber = document.getElementById('manual-new-phone').value.trim();
      const district = document.getElementById('manual-new-district').value.trim() || 'Kanyakumari';

      if (!fullName) {
        showToast('Farmer name is required.', 'error');
        if (btn) btn.disabled = false;
        return;
      }
      if (!contactNumber) {
        showToast('Contact phone number is required.', 'error');
        if (btn) btn.disabled = false;
        return;
      }

      const res = await authFetch('/api/farmers', {
        method: 'POST',
        body: JSON.stringify({
          full_name: fullName,
          name_ta: nameTa,
          contact_number: contactNumber,
          village,
          district,
          latitude: lat,
          longitude: lng,
          location_source: 'manual',
          address,
          notes
        })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to register farmer with manual location.');
      savedFarmerId = data.id;
      showToast(`New farmer ${data.full_name} (${data.id}) registered & stored with manual location!`, 'success');
    }

    closeManualLocationModal();

    // Refresh map data & tables
    await loadMapData();
    await loadAllMappedFarmersAndDue();
    fetchDashboardStats(false);

    // Smooth focus on the saved location
    if (savedFarmerId) {
      setTimeout(() => focusFarmerOnMap(savedFarmerId), 300);
    }
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function runManualLocationReviewScan() {
  try {
    const res = await authFetch('/api/farmers/locations/run-review', { method: 'POST' });
    const data = await res.json();
    showToast(data.message || '15-day review scan completed.', 'success');
    initLocationsMapView();
    fetchDashboardStats(false);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Modal: 15-Day Location Review
async function openLocationReviewForFarmer(farmerId) {
  try {
    const res = await authFetch(`/api/farmers/${farmerId}`);
    if (!res.ok) return;
    const farmer = await res.json();

    document.getElementById('loc-review-farmer-id').value = farmer.id;
    document.getElementById('loc-review-farmer-name').textContent = farmer.full_name;
    document.getElementById('loc-review-farmer-code').textContent = farmer.id;

    const statusPill = document.getElementById('loc-review-status-pill');
    statusPill.textContent = (farmer.location_review_status || 'unavailable').toUpperCase();
    statusPill.className = `badge-tag ${farmer.location_review_status || 'unavailable'}`;

    document.getElementById('loc-review-lat').value = farmer.latitude || '';
    document.getElementById('loc-review-lng').value = farmer.longitude || '';
    document.getElementById('loc-review-village').value = farmer.village || '';
    document.getElementById('loc-review-notes').value = '';

    document.getElementById('location-review-modal').classList.remove('hidden');
  } catch (err) {
    showToast('Failed to load farmer details.', 'error');
  }
}

function closeLocationReviewModal() {
  document.getElementById('location-review-modal').classList.add('hidden');
}

async function handleSubmitLocationReview(e) {
  e.preventDefault();
  const farmerId = document.getElementById('loc-review-farmer-id').value;
  const latitude = document.getElementById('loc-review-lat').value;
  const longitude = document.getElementById('loc-review-lng').value;
  const village = document.getElementById('loc-review-village').value.trim();
  const source = document.getElementById('loc-review-source').value;
  const review_notes = document.getElementById('loc-review-notes').value.trim();

  const btn = document.getElementById('btn-submit-review');
  btn.disabled = true;

  try {
    const res = await authFetch(`/api/farmers/${farmerId}/location`, {
      method: 'POST',
      body: JSON.stringify({ latitude, longitude, village, source, review_notes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast('Location verified and 15-day review cycle updated!', 'success');
    closeLocationReviewModal();

    if (state.currentView === 'locations') initLocationsMapView();
    else if (state.currentView === 'farmers') fetchFarmersList();
    fetchDashboardStats(false);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// Device HTML5 Geolocation Helper
function captureDeviceCoordinates(latElemId, lngElemId) {
  if (!navigator.geolocation) {
    showToast('Geolocation is not supported by your browser.', 'warn');
    return;
  }

  showToast('Requesting GPS device coordinates...', 'info');

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      document.getElementById(latElemId).value = pos.coords.latitude.toFixed(6);
      document.getElementById(lngElemId).value = pos.coords.longitude.toFixed(6);
      showToast('GPS coordinates captured accurately.', 'success');
    },
    (err) => {
      showToast(`GPS capture error: ${err.message}`, 'error');
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

// =========================================================
// 6. FLOWER HARVEST COLLECTIONS
// =========================================================
async function fetchCollectionsList() {
  const search = document.getElementById('collection-search-input')?.value || '';
  const flower = document.getElementById('collection-flower-filter')?.value || '';
  const payStatus = document.getElementById('collection-pay-filter')?.value || '';
  const page = state.collectionPagination.page;

  try {
    const res = await authFetch(`/api/collections?farmer_id=${encodeURIComponent(search)}&flower_type=${encodeURIComponent(flower)}&payment_status=${encodeURIComponent(payStatus)}&page=${page}&limit=${state.collectionPagination.limit}`);
    if (!res.ok) return;

    const data = await res.json();
    state.collectionPagination = data.pagination;

    document.getElementById('collections-records-counter').textContent = `${data.pagination.total} collection records`;

    renderCollectionsTable(data.collections);
    renderPaginationControls('collections-pagination', data.pagination, (p) => {
      state.collectionPagination.page = p;
      fetchCollectionsList();
    });

  } catch (err) {
    console.error('Failed to fetch collections:', err);
  }
}

function onCollectionFilterChange() {
  state.collectionPagination.page = 1;
  fetchCollectionsList();
}

function renderCollectionsTable(collections) {
  const tbody = document.getElementById('collections-table-tbody');
  if (!tbody) return;

  if (!collections || collections.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="11">
          <div class="empty-state-box">
            <div class="empty-icon">🌸</div>
            <h4>No Flower Collections Recorded</h4>
            <p>No harvest collections have been recorded yet. Click below to record flower intake from a registered farmer.</p>
            <button class="btn btn-primary btn-sm" onclick="openNewCollectionModal()">
              <span>+ Record Flower Collection</span>
            </button>
          </div>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = collections.map(c => `
    <tr style="${c.status === 'cancelled' ? 'opacity: 0.6; background: #FFF5F5;' : ''}">
      <td><span class="badge-code">${c.id}</span></td>
      <td>${c.collection_date}</td>
      <td><strong>${escapeHtml(c.farmer_name)}</strong> <small>(${c.farmer_id})</small></td>
      <td>${escapeHtml(c.farmer_village)}</td>
      <td><strong>${escapeHtml(c.flower_type)}</strong> <small>(${escapeHtml(c.variety || 'Local')})</small></td>
      <td><strong>${c.quantity_kg} kg</strong></td>
      <td>₹${c.rate_per_kg}</td>
      <td><strong>₹${c.total_amount.toLocaleString('en-IN')}</strong></td>
      <td>${escapeHtml(c.quality_grade || 'Grade A')}</td>
      <td>
        ${c.status === 'cancelled' ?
          `<span class="badge-tag cancelled">Cancelled</span>` :
          `<span class="badge-tag ${c.payment_status.toLowerCase()}">${c.payment_status}</span>`
        }
      </td>
      <td>
        ${c.status !== 'cancelled' ? `
          <button class="btn btn-outline btn-xs" onclick="handleCancelCollectionPrompt('${c.id}')" title="Reverse Collection">
            ✕ Reverse
          </button>
        ` : `<span style="font-size: 0.75rem; color: #94A3B8;">Reversed</span>`}
      </td>
    </tr>
  `).join('');
}

// Modal: Record Flower Collection
async function openNewCollectionModal(presetFarmerId = null) {
  document.getElementById('new-collection-form').reset();
  document.getElementById('col-date').value = new Date().toISOString().slice(0, 10);
  document.getElementById('col-total-display').textContent = '₹0';

  // Load farmers into select dropdown
  const select = document.getElementById('col-farmer-select');
  try {
    let res = await authFetch('/api/farmers/options');
    if (!res.ok) res = await authFetch('/api/farmers?limit=500');
    if (res.ok) {
      const data = await res.json();
      const list = data.farmers || [];
      select.innerHTML = '<option value="">-- Choose Registered Farmer --</option>' +
        list.map(f => `<option value="${f.id}" ${f.id === presetFarmerId ? 'selected' : ''}>${escapeHtml(f.full_name)} (${f.id}) - ${escapeHtml(f.village)}</option>`).join('');
    }
  } catch (e) {
    console.error('Failed to load farmer options for collection:', e);
  }

  document.getElementById('new-collection-modal').classList.remove('hidden');
}

function closeNewCollectionModal() {
  document.getElementById('new-collection-modal').classList.add('hidden');
}

function onCollectionFarmerChange(farmerId) {
  // Can populate defaults if needed
}

function calcCollectionTotal() {
  const weight = parseFloat(document.getElementById('col-weight').value) || 0;
  const rate = parseFloat(document.getElementById('col-rate').value) || 0;
  const total = Math.round(weight * rate * 100) / 100;
  document.getElementById('col-total-display').textContent = `₹${total.toLocaleString('en-IN')}`;
}

async function handleCreateCollection(e) {
  e.preventDefault();
  const farmer_id = document.getElementById('col-farmer-select').value;
  const collection_date = document.getElementById('col-date').value;
  const flower_type = document.getElementById('col-flower-type').value;
  const variety = document.getElementById('col-variety').value;
  const quality_grade = document.getElementById('col-quality').value;
  const quantity_kg = document.getElementById('col-weight').value;
  const rate_per_kg = document.getElementById('col-rate').value;
  const payment_status = document.getElementById('col-payment-status').value;
  const payment_mode = document.getElementById('col-payment-mode').value;
  const notes = document.getElementById('col-notes').value;
  const capture_gps_latitude = document.getElementById('col-lat').value;
  const capture_gps_longitude = document.getElementById('col-lng').value;

  const btn = document.getElementById('btn-save-collection');
  btn.disabled = true;

  try {
    const res = await authFetch('/api/collections', {
      method: 'POST',
      body: JSON.stringify({
        farmer_id, collection_date, flower_type, variety, quality_grade,
        quantity_kg, rate_per_kg, payment_status, payment_mode, notes,
        capture_gps_latitude, capture_gps_longitude
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Collection ${data.id} recorded successfully!`, 'success');
    closeNewCollectionModal();

    if (state.currentView === 'collections') fetchCollectionsList();
    fetchDashboardStats(false);
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// Cancel Collection with required audit reason
async function handleCancelCollectionPrompt(collectionId) {
  const reason = prompt(`Please enter a mandatory audit reason to reverse/cancel Collection ${collectionId}:`);
  if (!reason || !reason.trim()) {
    showToast('Reversal aborted: Reason is required for audit compliance.', 'warn');
    return;
  }

  try {
    const res = await authFetch(`/api/collections/${collectionId}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ reason: reason.trim() })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    fetchCollectionsList();
    fetchDashboardStats(false);
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function startCollectionForFarmer(farmerId) {
  closeFarmerProfileModal();
  openNewCollectionModal(farmerId);
}

// =========================================================
// 7. FARMER PROFILE FULL DRAWER
// =========================================================
async function openFarmerProfileModal(farmerId) {
  currentProfileFarmerId = farmerId;
  state.currentProfileFarmerId = farmerId;

  try {
    const res = await authFetch(`/api/farmers/${farmerId}`);
    if (!res.ok) return;
    const f = await res.json();

    document.getElementById('fp-avatar').textContent = (f.full_name || 'F').charAt(0).toUpperCase();
    document.getElementById('fp-name').textContent = f.full_name;
    document.getElementById('fp-id').textContent = f.id;
    document.getElementById('fp-contact').textContent = `Phone: ${f.contact_number}`;
    document.getElementById('fp-village').textContent = `Village: ${f.village}`;

    const locPill = document.getElementById('fp-loc-pill');
    locPill.textContent = (f.location_review_status || 'unavailable').toUpperCase();
    locPill.className = `badge-tag ${f.location_review_status || 'unavailable'}`;

    // Counts
    document.getElementById('fp-col-count').textContent = f.collections.length;
    document.getElementById('fp-loc-count').textContent = f.locationHistory.length;
    document.getElementById('fp-audit-count').textContent = f.auditTrail.length;

    // Render Collections Tab
    const colTbody = document.getElementById('fp-collections-tbody');
    colTbody.innerHTML = f.collections.map(c => `
      <tr>
        <td><span class="badge-code">${c.id}</span></td>
        <td>${c.collection_date}</td>
        <td>${escapeHtml(c.flower_type)}</td>
        <td><strong>${c.quantity_kg} kg</strong></td>
        <td>₹${c.rate_per_kg}</td>
        <td><strong>₹${c.total_amount.toLocaleString('en-IN')}</strong></td>
        <td><span class="badge-tag ${c.payment_status.toLowerCase()}">${c.payment_status}</span></td>
      </tr>
    `).join('') || `<tr><td colspan="7" style="text-align: center; color: #94A3B8;">No collections for this farmer yet.</td></tr>`;

    // Render Location History Tab (15-Day Historical Audits!)
    const locTbody = document.getElementById('fp-locations-tbody');
    locTbody.innerHTML = f.locationHistory.map(l => `
      <tr>
        <td>${formatDate(l.capture_timestamp)}</td>
        <td><strong>${l.latitude.toFixed(5)}, ${l.longitude.toFixed(5)}</strong></td>
        <td>${escapeHtml(l.source)}</td>
        <td><span class="badge-tag verified">Verified</span></td>
        <td>${escapeHtml(l.verified_by || 'Admin')}</td>
        <td>${escapeHtml(l.review_notes || '—')}</td>
      </tr>
    `).join('') || `<tr><td colspan="6" style="text-align: center; color: #94A3B8;">No historical GPS location records logged.</td></tr>`;

    // Render Audit Trail Tab
    const audTbody = document.getElementById('fp-audit-tbody');
    audTbody.innerHTML = f.auditTrail.map(a => `
      <tr>
        <td>${formatDate(a.timestamp)}</td>
        <td><strong>${escapeHtml(a.actor_name)}</strong></td>
        <td><span class="badge-code">${a.action}</span></td>
        <td>${escapeHtml(a.details)}</td>
      </tr>
    `).join('') || `<tr><td colspan="4" style="text-align: center; color: #94A3B8;">No audit trail events found.</td></tr>`;

    // Switch to first tab
    switchProfileTab('collections');

    document.getElementById('farmer-profile-modal').classList.remove('hidden');
  } catch (err) {
    showToast('Failed to load farmer profile.', 'error');
  }
}

function closeFarmerProfileModal() {
  document.getElementById('farmer-profile-modal').classList.add('hidden');
}

function switchProfileTab(tabName, btnElem = null) {
  document.querySelectorAll('.profile-tabs .tab-btn').forEach(b => b.classList.remove('active'));
  if (btnElem) btnElem.classList.add('active');

  document.getElementById('fp-tab-collections').classList.add('hidden');
  document.getElementById('fp-tab-locations').classList.add('hidden');
  document.getElementById('fp-tab-audit').classList.add('hidden');

  document.getElementById(`fp-tab-${tabName}`).classList.remove('hidden');
}

// =========================================================
// 8. REPORTS, EXPORTS & AUDIT LOGS
// =========================================================
async function fetchReportsData() {
  try {
    const res = await authFetch('/api/reports/summary');
    if (!res.ok) return;
    const data = await res.json();

    document.getElementById('rep-total-kg').textContent = `${data.summary.totalKg.toLocaleString('en-IN')} kg`;
    document.getElementById('rep-total-orders').textContent = `${data.summary.totalCollections} harvest intake batches`;
    document.getElementById('rep-disbursed').textContent = `₹${data.summary.paidAmount.toLocaleString('en-IN')}`;
    document.getElementById('rep-pending').textContent = `₹${data.summary.pendingAmount.toLocaleString('en-IN')}`;
    document.getElementById('rep-active-farmers').textContent = data.summary.activeFarmers;

    // Flower breakdown
    const flowerTbody = document.getElementById('report-flowers-tbody');
    flowerTbody.innerHTML = data.flowerBreakdown.map(f => `
      <tr>
        <td><strong>${escapeHtml(f.flower_type)}</strong></td>
        <td><strong>${f.total_kg} kg</strong></td>
        <td>₹${f.total_amount.toLocaleString('en-IN')}</td>
      </tr>
    `).join('') || `<tr><td colspan="3" style="text-align: center; color: #94A3B8;">No flower data.</td></tr>`;

    // Village breakdown
    const villageTbody = document.getElementById('report-villages-tbody');
    villageTbody.innerHTML = data.villageBreakdown.map(v => `
      <tr>
        <td><strong>${escapeHtml(v.village)}</strong></td>
        <td>${v.collections_count}</td>
        <td><strong>${v.total_kg} kg</strong></td>
        <td>₹${v.total_amount.toLocaleString('en-IN')}</td>
      </tr>
    `).join('') || `<tr><td colspan="4" style="text-align: center; color: #94A3B8;">No village data.</td></tr>`;

  } catch (err) {
    console.error(err);
  }
}

async function fetchAuditLogs() {
  const page = state.auditPagination.page;
  try {
    const res = await authFetch(`/api/audit-logs?page=${page}&limit=${state.auditPagination.limit}`);
    if (!res.ok) return;
    const data = await res.json();
    state.auditPagination = data.pagination;

    const tbody = document.getElementById('audit-logs-tbody');
    tbody.innerHTML = data.logs.map(l => `
      <tr>
        <td><code>${formatDate(l.timestamp)}</code></td>
        <td><strong>${escapeHtml(l.actor_name)}</strong></td>
        <td><span class="badge-code">${l.action}</span></td>
        <td>${escapeHtml(l.entity_type)}</td>
        <td>${l.entity_id ? `<span class="badge-code">${l.entity_id}</span>` : '—'}</td>
        <td>${escapeHtml(l.details)}</td>
        <td><small style="color: #64748B;">${escapeHtml(l.ip_address || 'Internal')}</small></td>
      </tr>
    `).join('') || `<tr><td colspan="7" style="text-align: center; color: #94A3B8; padding: 24px;">No audit trail events logged yet.</td></tr>`;

    renderPaginationControls('audit-pagination', data.pagination, (p) => {
      state.auditPagination.page = p;
      fetchAuditLogs();
    });

  } catch (err) {
    console.error(err);
  }
}

function exportCollectionsCsv() {
  window.open('/api/reports/export/collections-csv', '_blank');
}

function exportFarmersCsv() {
  window.open('/api/reports/export/farmers-csv', '_blank');
}

function exportLocationsCsv() {
  window.open('/api/reports/export/farmers-csv', '_blank');
}

function exportBuyersCsv() {
  window.open('/api/reports/export/buyers-csv', '_blank');
}

function exportDistributionsCsv() {
  window.open('/api/reports/export/distributions-csv', '_blank');
}

function exportSellingBillsCsv() {
  window.open('/api/reports/export/selling-bills-csv', '_blank');
}

// =========================================================
// 8. SELLING MANAGEMENT & BUYERS MODULE
// =========================================================

function loadSellingData() {
  switchSellingTab(state.activeSellingTab || 'buyers');
}

function switchSellingTab(tabKey) {
  state.activeSellingTab = tabKey;
  document.querySelectorAll('.selling-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.subtab === tabKey);
  });
  document.querySelectorAll('.selling-subtab').forEach(s => {
    s.classList.toggle('hidden', s.id !== `selling-subtab-${tabKey}`);
  });

  if (tabKey === 'buyers') fetchBuyersList();
  else if (tabKey === 'distributions') fetchDistributionsList();
  else if (tabKey === 'bills') fetchSellingBillsList();
}

// --- SUB-TAB 1: BUYERS DIRECTORY (20-25 WHOLESALE BUYERS) ---

async function fetchBuyersList() {
  const search = document.getElementById('buyer-search-input')?.value || '';
  const market = document.getElementById('buyer-market-filter')?.value || '';
  const page = state.buyerPagination.page || 1;
  const limit = state.buyerPagination.limit || 15;

  try {
    const res = await authFetch(`/api/buyers?search=${encodeURIComponent(search)}&market=${encodeURIComponent(market)}&page=${page}&limit=${limit}`);
    if (!res.ok) return;

    const data = await res.json();
    state.buyers = data.buyers || [];
    state.buyerPagination = data.pagination || { page: 1, limit: 15, total: 0, totalPages: 0 };

    // Update records counter & sidebar badges
    const counter = document.getElementById('buyer-records-counter');
    if (counter) counter.textContent = `${state.buyerPagination.total} wholesale buyers`;
    const sideBadge = document.getElementById('nav-selling-buyer-count');
    if (sideBadge) sideBadge.textContent = state.buyerPagination.total;
    const tabBadge = document.getElementById('tab-buyers-badge');
    if (tabBadge) tabBadge.textContent = state.buyerPagination.total;

    renderBuyersTable(state.buyers);
    renderPaginationControls('buyers-pagination', state.buyerPagination, (p) => {
      state.buyerPagination.page = p;
      fetchBuyersList();
    });

    // Populate buyer selects in modals if needed
    populateBuyerSelectDropdowns(state.buyers);

  } catch (err) {
    console.error('Failed to fetch buyers list:', err);
  }
}

function populateBuyerSelectDropdowns(buyers) {
  const distSelect = document.getElementById('dist-buyer-select');
  if (distSelect) {
    const curVal = distSelect.value;
    distSelect.innerHTML = '<option value="">-- Choose Wholesale Buyer --</option>' +
      buyers.map(b => `<option value="${b.id}" ${b.id === curVal ? 'selected' : ''}>${escapeHtml(b.name)} (${escapeHtml(b.market_city)})</option>`).join('');
  }

  const billSelect = document.getElementById('gen-bill-buyer-select');
  if (billSelect) {
    const curVal = billSelect.value;
    billSelect.innerHTML = '<option value="">-- Choose Wholesale Buyer --</option>' +
      buyers.map(b => `<option value="${b.id}" ${b.id === curVal ? 'selected' : ''}>${escapeHtml(b.name)} [${b.billing_cycle_days || 6}-Day Cycle] (Bal: ₹${Number(b.current_balance).toLocaleString('en-IN')})</option>`).join('');
  }
}

function onBuyerSearchChange(val) {
  state.buyerPagination.page = 1;
  fetchBuyersList();
}

function onBuyerFilterChange() {
  state.buyerPagination.page = 1;
  fetchBuyersList();
}

function renderBuyersTable(buyers) {
  const tbody = document.getElementById('buyers-table-tbody');
  if (!tbody) return;

  if (!buyers || buyers.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="9" style="text-align: center; color: #94A3B8; padding: 32px;">
          <div style="font-size: 1.8rem; margin-bottom: 6px;">🏪</div>
          <strong>No Wholesale Buyers Found</strong>
          <p style="font-size: 0.85rem; margin-top: 4px;">No buyers match the filter criteria. Add a new buyer using the button above.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = buyers.map(b => {
    const bal = Number(b.current_balance || 0);
    const balClass = bal > 0 ? 'text-rose' : 'text-green';
    const totalPurchased = Number(b.total_purchased || 0).toLocaleString('en-IN');
    const cycleDays = b.billing_cycle_days || 6;

    return `
      <tr>
        <td><span class="badge-code">${escapeHtml(b.id)}</span></td>
        <td>
          <strong>${escapeHtml(b.name)}</strong>
          ${b.name_ta ? `<br><small class="text-subtle">${escapeHtml(b.name_ta)}</small>` : ''}
          ${b.contact_person ? `<div style="font-size: 0.72rem; color: #64748B;">Attn: ${escapeHtml(b.contact_person)}</div>` : ''}
        </td>
        <td>${escapeHtml(b.market_city)}</td>
        <td>${escapeHtml(b.phone)}</td>
        <td><span class="badge-tag info">${cycleDays}-Day Cycle</span></td>
        <td><strong>₹${Number(b.credit_limit || 0).toLocaleString('en-IN')}</strong></td>
        <td><strong>₹${totalPurchased}</strong></td>
        <td><strong class="${balClass}">₹${bal.toLocaleString('en-IN')}</strong></td>
        <td>
          <div style="display: flex; gap: 4px; flex-wrap: wrap;">
            <button class="btn btn-primary btn-xs" onclick="openNewDistributionModalForBuyer('${escapeHtml(b.id)}')" title="Dispatch Flowers to Buyer">+ Dispatch</button>
            <button class="btn btn-outline btn-xs" onclick="openGenerateBillModalForBuyer('${escapeHtml(b.id)}')" title="Generate Consolidated 5-6 Day Bill">📄 Bill</button>
            <button class="btn btn-outline btn-xs" onclick="openRecordBuyerPayment('${escapeHtml(b.id)}')" title="Record Buyer Settlement Payment">💰 Pay</button>
            <button class="btn btn-outline btn-xs" onclick="openEditBuyerModal('${escapeHtml(b.id)}')" title="Edit Buyer Details">✏️ Edit</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

function openNewBuyerModal() {
  const form = document.getElementById('new-buyer-form');
  if (form) form.reset();
  document.getElementById('buyer-edit-id').value = '';
  document.getElementById('buyer-modal-title').textContent = 'Register Wholesale Flower Buyer';
  document.getElementById('buyer-billing-cycle').value = '6';
  document.getElementById('new-buyer-modal')?.classList.remove('hidden');
}

function closeNewBuyerModal() {
  document.getElementById('new-buyer-modal')?.classList.add('hidden');
}

async function openEditBuyerModal(id) {
  try {
    const res = await authFetch(`/api/buyers/${encodeURIComponent(id)}`);
    if (!res.ok) return;
    const b = await res.json();

    document.getElementById('buyer-edit-id').value = b.id;
    document.getElementById('buyer-name').value = b.name || '';
    document.getElementById('buyer-name-ta').value = b.name_ta || '';
    document.getElementById('buyer-contact-person').value = b.contact_person || '';
    document.getElementById('buyer-phone').value = b.phone || '';
    document.getElementById('buyer-email').value = b.email || '';
    document.getElementById('buyer-market-city').value = b.market_city || '';
    document.getElementById('buyer-billing-cycle').value = b.billing_cycle_days || 6;
    document.getElementById('buyer-credit-limit').value = b.credit_limit || 50000;
    document.getElementById('buyer-address').value = b.address || '';
    document.getElementById('buyer-notes').value = b.notes || '';

    document.getElementById('buyer-modal-title').textContent = `Edit Wholesale Buyer (${b.id})`;
    document.getElementById('new-buyer-modal')?.classList.remove('hidden');
  } catch (err) {
    showToast('Failed to load buyer details', 'error');
  }
}

async function handleCreateBuyer(e) {
  e.preventDefault();
  const editId = document.getElementById('buyer-edit-id')?.value;
  const name = document.getElementById('buyer-name').value.trim();
  const name_ta = document.getElementById('buyer-name-ta').value.trim();
  const contact_person = document.getElementById('buyer-contact-person').value.trim();
  const phone = document.getElementById('buyer-phone').value.trim();
  const email = document.getElementById('buyer-email').value.trim();
  const market_city = document.getElementById('buyer-market-city').value.trim();
  const billing_cycle_days = parseInt(document.getElementById('buyer-billing-cycle').value) || 6;
  const credit_limit = parseFloat(document.getElementById('buyer-credit-limit').value) || 0;
  const address = document.getElementById('buyer-address').value.trim();
  const notes = document.getElementById('buyer-notes').value.trim();

  const btn = document.getElementById('btn-save-buyer');
  if (btn) btn.disabled = true;

  try {
    const url = editId ? `/api/buyers/${encodeURIComponent(editId)}` : '/api/buyers';
    const method = editId ? 'PUT' : 'POST';

    const res = await authFetch(url, {
      method,
      body: JSON.stringify({ name, name_ta, contact_person, phone, email, market_city, billing_cycle_days, credit_limit, address, notes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to save buyer');

    showToast(`Buyer ${data.name} saved successfully!`, 'success');
    closeNewBuyerModal();
    fetchBuyersList();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --- SUB-TAB 2: FLOWER DISTRIBUTIONS (TRACKED FROM PROCUREMENT ORIGINS) ---

async function fetchDistributionsList() {
  const search = document.getElementById('dist-search-input')?.value || '';
  const origin = document.getElementById('dist-location-filter')?.value || '';
  const flower = document.getElementById('dist-flower-filter')?.value || '';
  const billing_status = document.getElementById('dist-bill-status-filter')?.value || '';
  const page = state.distPagination.page || 1;
  const limit = state.distPagination.limit || 15;

  try {
    const res = await authFetch(`/api/selling/distributions?search=${encodeURIComponent(search)}&origin=${encodeURIComponent(origin)}&flower=${encodeURIComponent(flower)}&billing_status=${encodeURIComponent(billing_status)}&page=${page}&limit=${limit}`);
    if (!res.ok) return;

    const data = await res.json();
    state.distributions = data.distributions || [];
    state.distPagination = data.pagination || { page: 1, limit: 15, total: 0, totalPages: 0 };

    const counter = document.getElementById('dist-records-counter');
    if (counter) counter.textContent = `${state.distPagination.total} distributions`;

    renderDistributionsTable(state.distributions);
    renderPaginationControls('distributions-pagination', state.distPagination, (p) => {
      state.distPagination.page = p;
      fetchDistributionsList();
    });

    // Also fetch summary for origin location badges
    fetchDistributionsSummary();

  } catch (err) {
    console.error('Failed to fetch distributions:', err);
  }
}

async function fetchDistributionsSummary() {
  try {
    const res = await authFetch('/api/selling/distributions/summary');
    if (!res.ok) return;
    const summary = await res.json();
    renderOriginLocationChips(summary.byOrigin);
  } catch (err) {
    console.error('Failed to load distributions summary:', err);
  }
}

function renderOriginLocationChips(origins) {
  const container = document.getElementById('origin-location-chips');
  if (!container) return;

  if (!origins || origins.length === 0) {
    container.innerHTML = '<span class="text-subtle">No procurement distributions recorded.</span>';
    return;
  }

  const activeOrigin = document.getElementById('dist-location-filter')?.value || '';

  container.innerHTML = origins.map(o => {
    const isAct = o.procurement_origin === activeOrigin;
    return `
      <div class="origin-chip ${isAct ? 'active' : ''}" onclick="filterDistributionsByOrigin('${escapeHtml(o.procurement_origin)}')">
        <span class="origin-chip-name">📍 ${escapeHtml(o.procurement_origin)}</span>
        <span class="origin-chip-badge">${o.total_kg} kg</span>
        <span style="font-size: 0.72rem; color: #15803D;">₹${Number(o.total_amount).toLocaleString('en-IN')}</span>
      </div>
    `;
  }).join('');
}

function filterDistributionsByOrigin(origin) {
  const filter = document.getElementById('dist-location-filter');
  if (filter) {
    filter.value = (filter.value === origin) ? '' : origin;
    onDistFilterChange();
  }
}

function onDistFilterChange() {
  state.distPagination.page = 1;
  fetchDistributionsList();
}

function renderDistributionsTable(distributions) {
  const tbody = document.getElementById('distributions-table-tbody');
  if (!tbody) return;

  if (!distributions || distributions.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="12" style="text-align: center; color: #94A3B8; padding: 32px;">
          <div style="font-size: 1.8rem; margin-bottom: 6px;">🚛</div>
          <strong>No Flower Distribution Records Found</strong>
          <p style="font-size: 0.85rem; margin-top: 4px;">Record flower dispatches from procurement origins (Thovalai, Nilakottai, Hosur, etc.) to wholesale buyers.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = distributions.map(d => {
    const isBilled = d.billing_status === 'billed';
    const statusTag = isBilled
      ? `<span class="badge-tag paid" title="Billed in ${d.selling_bill_id}">Billed (${escapeHtml(d.selling_bill_id)})</span>`
      : `<span class="badge-tag pending">Unbilled</span>`;

    const coolieFreight = (Number(d.coolie_charge || 0) + Number(d.transport_charge || 0)).toLocaleString('en-IN');

    return `
      <tr>
        <td><span class="badge-code">${escapeHtml(d.id)}</span></td>
        <td>${escapeHtml(d.distribution_date)}</td>
        <td>
          <strong>${escapeHtml(d.buyer_name)}</strong>
          ${d.buyer_market ? `<br><small class="text-subtle">${escapeHtml(d.buyer_market)}</small>` : ''}
        </td>
        <td><span class="badge-tag info">📍 ${escapeHtml(d.procurement_origin)}</span></td>
        <td>
          <strong>${escapeHtml(d.flower_type)}</strong>
          ${d.variety ? `<br><small class="text-subtle">${escapeHtml(d.variety)}</small>` : ''}
        </td>
        <td><strong>${d.weight_kg} kg</strong></td>
        <td>₹${d.rate_per_kg}</td>
        <td><strong>₹${Number(d.total_amount).toLocaleString('en-IN')}</strong></td>
        <td>₹${coolieFreight}</td>
        <td><code>${escapeHtml(d.vehicle_number || '—')}</code></td>
        <td>${statusTag}</td>
        <td>
          ${!isBilled ? `<button class="btn btn-outline btn-xs text-rose" onclick="deleteDistribution('${d.id}')" title="Delete Unbilled Distribution">🗑️</button>` : '—'}
        </td>
      </tr>
    `;
  }).join('');
}

function openNewDistributionModal() {
  const form = document.getElementById('new-distribution-form');
  if (form) form.reset();
  const dateInput = document.getElementById('dist-date');
  if (dateInput) dateInput.value = new Date().toISOString().split('T')[0];
  calcDistTotal();
  document.getElementById('new-distribution-modal')?.classList.remove('hidden');
}

function openNewDistributionModalForBuyer(buyerId) {
  openNewDistributionModal();
  const select = document.getElementById('dist-buyer-select');
  if (select) select.value = buyerId;
}

function closeNewDistributionModal() {
  document.getElementById('new-distribution-modal')?.classList.add('hidden');
}

function calcDistTotal() {
  const weight = parseFloat(document.getElementById('dist-weight')?.value) || 0;
  const rate = parseFloat(document.getElementById('dist-rate')?.value) || 0;
  const coolie = parseFloat(document.getElementById('dist-coolie')?.value) || 0;
  const transport = parseFloat(document.getElementById('dist-transport')?.value) || 0;

  const flowerVal = weight * rate;
  const total = flowerVal + coolie + transport;

  const flDisplay = document.getElementById('dist-flower-value-display');
  if (flDisplay) flDisplay.textContent = `Flowers: ₹${flowerVal.toLocaleString('en-IN')}`;

  const totalDisplay = document.getElementById('dist-total-display');
  if (totalDisplay) totalDisplay.textContent = `₹${total.toLocaleString('en-IN')}`;
}

async function handleCreateDistribution(e) {
  e.preventDefault();
  const buyer_id = document.getElementById('dist-buyer-select').value;
  const distribution_date = document.getElementById('dist-date').value;
  const procurement_origin = document.getElementById('dist-procurement-origin').value;
  const flower_type = document.getElementById('dist-flower-type').value;
  const variety = document.getElementById('dist-variety').value.trim();
  const weight_kg = parseFloat(document.getElementById('dist-weight').value);
  const rate_per_kg = parseFloat(document.getElementById('dist-rate').value);
  const coolie_charge = parseFloat(document.getElementById('dist-coolie').value) || 0;
  const transport_charge = parseFloat(document.getElementById('dist-transport').value) || 0;
  const vehicle_number = document.getElementById('dist-vehicle').value.trim();
  const remarks = document.getElementById('dist-remarks').value.trim();

  const btn = document.getElementById('btn-save-dist');
  if (btn) btn.disabled = true;

  try {
    const res = await authFetch('/api/selling/distributions', {
      method: 'POST',
      body: JSON.stringify({
        buyer_id, distribution_date, procurement_origin, flower_type, variety,
        weight_kg, rate_per_kg, coolie_charge, transport_charge, vehicle_number, remarks
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to record distribution');

    showToast(`Distribution dispatch ${data.id} recorded successfully!`, 'success');
    closeNewDistributionModal();
    fetchDistributionsList();
    fetchBuyersList();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

async function deleteDistribution(id) {
  if (!confirm(`Are you sure you want to delete distribution dispatch ${id}?`)) return;
  try {
    const res = await authFetch(`/api/selling/distributions/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to delete distribution');

    showToast(`Distribution ${id} deleted successfully.`, 'info');
    fetchDistributionsList();
    fetchBuyersList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// --- SUB-TAB 3: CONSOLIDATED 5-6 DAY SELLING BILLS ---

async function fetchSellingBillsList() {
  const search = document.getElementById('bill-search-input')?.value || '';
  const payment_status = document.getElementById('bill-pay-filter')?.value || '';
  const page = state.sellingBillsPagination.page || 1;
  const limit = state.sellingBillsPagination.limit || 15;

  try {
    const res = await authFetch(`/api/selling/bills?search=${encodeURIComponent(search)}&payment_status=${encodeURIComponent(payment_status)}&page=${page}&limit=${limit}`);
    if (!res.ok) return;

    const data = await res.json();
    state.sellingBills = data.bills || [];
    state.sellingBillsPagination = data.pagination || { page: 1, limit: 15, total: 0, totalPages: 0 };

    const counter = document.getElementById('bills-records-counter');
    if (counter) counter.textContent = `${state.sellingBillsPagination.total} consolidated bills`;

    renderSellingBillsTable(state.sellingBills);
    renderPaginationControls('bills-pagination', state.sellingBillsPagination, (p) => {
      state.sellingBillsPagination.page = p;
      fetchSellingBillsList();
    });

  } catch (err) {
    console.error('Failed to fetch selling bills:', err);
  }
}

function onBillFilterChange() {
  state.sellingBillsPagination.page = 1;
  fetchSellingBillsList();
}

function renderSellingBillsTable(bills) {
  const tbody = document.getElementById('selling-bills-table-tbody');
  if (!tbody) return;

  if (!bills || bills.length === 0) {
    tbody.innerHTML = `
      <tr>
        <td colspan="12" style="text-align: center; color: #94A3B8; padding: 32px;">
          <div style="font-size: 1.8rem; margin-bottom: 6px;">📄</div>
          <strong>No Consolidated Selling Bills Generated Yet</strong>
          <p style="font-size: 0.85rem; margin-top: 4px;">Click the "+ Generate 5-6 Day Bill" button to create an official wholesale flower mandi statement.</p>
        </td>
      </tr>
    `;
    return;
  }

  tbody.innerHTML = bills.map(b => {
    const statusClass = b.payment_status === 'Paid' ? 'paid' : b.payment_status === 'Partial' ? 'info' : 'pending';
    const coolieFreight = (Number(b.total_coolie || 0) + Number(b.total_transport || 0)).toLocaleString('en-IN');
    const balDue = Number(b.balance_due || 0);

    return `
      <tr>
        <td><span class="badge-code">${escapeHtml(b.bill_number)}</span></td>
        <td>${escapeHtml(b.bill_date)}</td>
        <td>
          <strong>${escapeHtml(b.buyer_name)}</strong>
          ${b.buyer_market ? `<br><small class="text-subtle">${escapeHtml(b.buyer_market)}</small>` : ''}
        </td>
        <td><span class="badge-tag info">${escapeHtml(b.period_from)} to ${escapeHtml(b.period_to)} (${b.billing_cycle_days}d)</span></td>
        <td><strong>${b.total_weight_kg} kg</strong></td>
        <td>₹${Number(b.gross_flower_amount).toLocaleString('en-IN')}</td>
        <td>₹${coolieFreight}</td>
        <td><strong>₹${Number(b.grand_total).toLocaleString('en-IN')}</strong></td>
        <td><strong class="text-green">₹${Number(b.amount_paid).toLocaleString('en-IN')}</strong></td>
        <td><strong class="${balDue > 0 ? 'text-rose' : 'text-green'}">₹${balDue.toLocaleString('en-IN')}</strong></td>
        <td><span class="badge-tag ${statusClass}">${escapeHtml(b.payment_status)}</span></td>
        <td>
          <div style="display: flex; gap: 4px;">
            <button class="btn btn-primary btn-xs" onclick="openSellingBillModal('${escapeHtml(b.id)}')" title="View Client Format Mandi Bill">👁️ View</button>
            <a href="/api/selling/bills/${encodeURIComponent(b.id)}/export-excel" class="btn btn-outline btn-xs" target="_blank" title="Download Excel">📥 Excel</a>
            ${b.payment_status !== 'Paid' ? `<button class="btn btn-outline btn-xs" onclick="openRecordBillPaymentModal('${escapeHtml(b.id)}')" title="Record Bill Payment">💰 Pay</button>` : ''}
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

// --- BILL GENERATION WIZARD (5-6 DAY CONSOLIDATION) ---

function openGenerateBillModal() {
  const formSelect = document.getElementById('gen-bill-buyer-select');
  if (formSelect) populateBuyerSelectDropdowns(state.buyers);
  setBillCyclePreset(6); // Default 6 days
  state.unbilledDistributions = [];
  state.selectedUnbilledIds = new Set();
  renderUnbilledDistributionsTable([]);
  recalcBillTotals();
  document.getElementById('generate-bill-modal')?.classList.remove('hidden');
}

function openGenerateBillModalForBuyer(buyerId) {
  openGenerateBillModal();
  const select = document.getElementById('gen-bill-buyer-select');
  if (select) {
    select.value = buyerId;
    onGenerateBillBuyerChange(buyerId);
  }
}

function closeGenerateBillModal() {
  document.getElementById('generate-bill-modal')?.classList.add('hidden');
}

function setBillCyclePreset(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(end.getDate() - (days - 1));

  const startInput = document.getElementById('gen-bill-start-date');
  const endInput = document.getElementById('gen-bill-end-date');
  if (startInput) startInput.value = start.toISOString().split('T')[0];
  if (endInput) endInput.value = end.toISOString().split('T')[0];

  fetchUnbilledDistributionsForBill();
}

function onGenerateBillBuyerChange(buyerId) {
  const buyer = state.buyers.find(b => b.id === buyerId);
  if (buyer && buyer.billing_cycle_days) {
    setBillCyclePreset(buyer.billing_cycle_days);
  } else {
    fetchUnbilledDistributionsForBill();
  }
}

async function fetchUnbilledDistributionsForBill() {
  const buyerId = document.getElementById('gen-bill-buyer-select')?.value;
  const startDate = document.getElementById('gen-bill-start-date')?.value;
  const endDate = document.getElementById('gen-bill-end-date')?.value;

  if (!buyerId) {
    renderUnbilledDistributionsTable([]);
    return;
  }

  try {
    let url = `/api/selling/unbilled-distributions?buyer_id=${encodeURIComponent(buyerId)}`;
    if (startDate) url += `&startDate=${encodeURIComponent(startDate)}`;
    if (endDate) url += `&endDate=${encodeURIComponent(endDate)}`;

    const res = await authFetch(url);
    if (!res.ok) return;

    const data = await res.json();
    state.unbilledDistributions = data.distributions || [];
    state.selectedUnbilledIds = new Set(state.unbilledDistributions.map(d => d.id));

    // Update count display
    const countEl = document.getElementById('unbilled-count');
    if (countEl) countEl.textContent = state.unbilledDistributions.length;

    // Set buyer previous balance display
    const prevBalEl = document.getElementById('gen-calc-prev-bal');
    if (prevBalEl) {
      const prevBal = Number(data.buyer?.current_balance || 0);
      prevBalEl.textContent = `₹${prevBal.toLocaleString('en-IN')}`;
      prevBalEl.dataset.prevBal = prevBal;
    }

    renderUnbilledDistributionsTable(state.unbilledDistributions);
    recalcBillTotals();

  } catch (err) {
    console.error('Failed to fetch unbilled distributions:', err);
  }
}

function renderUnbilledDistributionsTable(items) {
  const tbody = document.getElementById('unbilled-distributions-tbody');
  if (!tbody) return;

  if (!items || items.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" style="text-align: center; color: #94A3B8; padding: 20px;">No unbilled dispatches found for this buyer in the selected date range.</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map(d => {
    const isChecked = state.selectedUnbilledIds.has(d.id);
    return `
      <tr>
        <td><input type="checkbox" ${isChecked ? 'checked' : ''} onchange="toggleUnbilledItem('${d.id}', this.checked)"></td>
        <td>${escapeHtml(d.distribution_date)}</td>
        <td><span class="badge-tag info">📍 ${escapeHtml(d.procurement_origin)}</span></td>
        <td>${escapeHtml(d.flower_type)}</td>
        <td>${d.weight_kg} kg</td>
        <td>₹${d.rate_per_kg}</td>
        <td>₹${d.coolie_charge || 0}</td>
        <td>₹${d.transport_charge || 0}</td>
        <td><strong>₹${Number(d.total_amount).toLocaleString('en-IN')}</strong></td>
      </tr>
    `;
  }).join('');
}

function toggleSelectAllUnbilled(checked) {
  if (checked) {
    state.selectedUnbilledIds = new Set(state.unbilledDistributions.map(d => d.id));
  } else {
    state.selectedUnbilledIds.clear();
  }
  renderUnbilledDistributionsTable(state.unbilledDistributions);
  recalcBillTotals();
}

function toggleUnbilledItem(id, checked) {
  if (checked) state.selectedUnbilledIds.add(id);
  else state.selectedUnbilledIds.delete(id);
  recalcBillTotals();
}

function recalcBillTotals() {
  const selectedItems = state.unbilledDistributions.filter(d => state.selectedUnbilledIds.has(d.id));

  let totalWeight = 0;
  let grossFlowers = 0;
  let coolieCharges = 0;
  let transportCharges = 0;

  selectedItems.forEach(d => {
    totalWeight += Number(d.weight_kg || 0);
    grossFlowers += Number(d.weight_kg || 0) * Number(d.rate_per_kg || 0);
    coolieCharges += Number(d.coolie_charge || 0);
    transportCharges += Number(d.transport_charge || 0);
  });

  const prevBal = parseFloat(document.getElementById('gen-calc-prev-bal')?.dataset?.prevBal || '0') || 0;
  const discount = parseFloat(document.getElementById('gen-bill-discount')?.value) || 0;
  const advance = parseFloat(document.getElementById('gen-bill-advance')?.value) || 0;

  const currentBillTotal = grossFlowers + coolieCharges + transportCharges - discount;
  const grandTotal = currentBillTotal + prevBal;

  document.getElementById('gen-calc-weight').textContent = `${totalWeight.toFixed(1)} kg`;
  document.getElementById('gen-calc-gross').textContent = `₹${grossFlowers.toLocaleString('en-IN')}`;
  document.getElementById('gen-calc-charges').textContent = `₹${(coolieCharges + transportCharges).toLocaleString('en-IN')}`;
  document.getElementById('gen-calc-grand-total').textContent = `₹${grandTotal.toLocaleString('en-IN')}`;
}

async function handleGenerateBillSubmit() {
  const buyer_id = document.getElementById('gen-bill-buyer-select').value;
  const period_from = document.getElementById('gen-bill-start-date').value;
  const period_to = document.getElementById('gen-bill-end-date').value;
  const distribution_ids = Array.from(state.selectedUnbilledIds);
  const discount_amount = parseFloat(document.getElementById('gen-bill-discount').value) || 0;
  const advance_paid = parseFloat(document.getElementById('gen-bill-advance').value) || 0;
  const notes = document.getElementById('gen-bill-notes').value.trim();

  if (!buyer_id) {
    showToast('Please select a wholesale buyer.', 'warn');
    return;
  }
  if (distribution_ids.length === 0) {
    showToast('Please select at least one flower distribution dispatch to consolidate.', 'warn');
    return;
  }

  const btn = document.getElementById('btn-submit-generate-bill');
  if (btn) btn.disabled = true;

  try {
    const res = await authFetch('/api/selling/bills/generate', {
      method: 'POST',
      body: JSON.stringify({ buyer_id, period_from, period_to, distribution_ids, discount_amount, advance_paid, notes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate bill');

    showToast(`Consolidated Mandi Bill #${data.bill_number} generated successfully!`, 'success');
    closeGenerateBillModal();
    fetchSellingBillsList();
    fetchBuyersList();

    // Immediately open printable bill modal
    openSellingBillModal(data.id);

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --- CLIENT WHOLESALE FLOWER COMMISSION MANDI INVOICE DISPLAY ---

async function openSellingBillModal(billId) {
  try {
    const res = await authFetch(`/api/selling/bills/${encodeURIComponent(billId)}`);
    if (!res.ok) throw new Error('Failed to load bill');

    const data = await res.json();
    state.currentSellingBill = data;
    renderPrintableSellingBill(data);

    document.getElementById('selling-bill-modal')?.classList.remove('hidden');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function renderPrintableSellingBill(data) {
  const b = data.bill;
  const items = data.items || [];
  const buyer = data.buyer || {};

  // Action Bar Status
  const statusEl = document.getElementById('inv-status-pill');
  if (statusEl) {
    statusEl.textContent = (b.payment_status || 'Pending').toUpperCase();
    statusEl.className = `badge-tag ${b.payment_status === 'Paid' ? 'paid' : b.payment_status === 'Partial' ? 'info' : 'pending'}`;
  }
  document.getElementById('inv-bill-num-top').textContent = `BILL #${b.bill_number}`;

  // Cycle Tag
  document.getElementById('inv-cycle-label').textContent = `${b.billing_cycle_days || 6}-DAY SETTLEMENT CYCLE`;

  // Buyer Info
  document.getElementById('inv-buyer-name').textContent = buyer.name || b.buyer_name;
  document.getElementById('inv-buyer-city').textContent = buyer.market_city || 'Wholesale Flower Market';
  document.getElementById('inv-buyer-phone').textContent = buyer.phone || '—';
  document.getElementById('inv-buyer-id').textContent = buyer.id || '—';

  // Invoice Meta
  document.getElementById('inv-bill-number').textContent = b.bill_number;
  document.getElementById('inv-bill-date').textContent = b.bill_date;
  document.getElementById('inv-period').textContent = `${b.period_from} to ${b.period_to} (${b.billing_cycle_days || 6} Days)`;
  document.getElementById('inv-due-date').textContent = b.due_date || '—';

  // Populate Itemized Table
  const tbody = document.getElementById('inv-items-tbody');
  if (tbody) {
    tbody.innerHTML = items.map((it, idx) => `
      <tr>
        <td style="text-align: center;">${idx + 1}</td>
        <td>${escapeHtml(it.item_date)}</td>
        <td><strong>📍 ${escapeHtml(it.procurement_origin)}</strong></td>
        <td>${escapeHtml(it.flower_type)} ${it.variety ? `<small>(${escapeHtml(it.variety)})</small>` : ''}</td>
        <td style="text-align: right;">${it.weight_kg} kg</td>
        <td style="text-align: right;">₹${it.rate_per_kg}</td>
        <td style="text-align: right;">₹${Number(it.flower_amount).toLocaleString('en-IN')}</td>
        <td style="text-align: right;">₹${Number(it.coolie_charge || 0).toLocaleString('en-IN')}</td>
        <td style="text-align: right;">₹${Number(it.transport_charge || 0).toLocaleString('en-IN')}</td>
        <td style="text-align: right; font-weight: 700;">₹${Number(it.total_item_amount).toLocaleString('en-IN')}</td>
      </tr>
    `).join('');
  }

  // Footers
  document.getElementById('inv-foot-kg').textContent = `${b.total_weight_kg} kg`;
  document.getElementById('inv-foot-gross').textContent = `₹${Number(b.gross_flower_amount).toLocaleString('en-IN')}`;
  document.getElementById('inv-foot-coolie').textContent = `₹${Number(b.total_coolie || 0).toLocaleString('en-IN')}`;
  document.getElementById('inv-foot-freight').textContent = `₹${Number(b.total_transport || 0).toLocaleString('en-IN')}`;
  document.getElementById('inv-foot-total').textContent = `₹${Number(b.subtotal_amount).toLocaleString('en-IN')}`;

  // Totals Box
  document.getElementById('inv-calc-weight').textContent = `${b.total_weight_kg} kg`;
  document.getElementById('inv-calc-gross').textContent = `₹${Number(b.gross_flower_amount).toLocaleString('en-IN')}`;
  document.getElementById('inv-calc-coolie').textContent = `₹${Number(b.total_coolie || 0).toLocaleString('en-IN')}`;
  document.getElementById('inv-calc-freight').textContent = `₹${Number(b.total_transport || 0).toLocaleString('en-IN')}`;

  const discRow = document.getElementById('inv-discount-row');
  if (b.discount_amount > 0) {
    discRow.style.display = 'flex';
    document.getElementById('inv-calc-discount').textContent = `-₹${Number(b.discount_amount).toLocaleString('en-IN')}`;
  } else {
    discRow.style.display = 'none';
  }

  document.getElementById('inv-calc-subtotal').textContent = `₹${Number(b.subtotal_amount).toLocaleString('en-IN')}`;
  document.getElementById('inv-calc-prev-bal').textContent = `₹${Number(b.previous_balance || 0).toLocaleString('en-IN')}`;
  document.getElementById('inv-calc-grand-total').textContent = `₹${Number(b.grand_total).toLocaleString('en-IN')}`;
  document.getElementById('inv-calc-paid').textContent = `₹${Number(b.amount_paid || 0).toLocaleString('en-IN')}`;
  document.getElementById('inv-calc-bal-due').textContent = `₹${Number(b.balance_due || 0).toLocaleString('en-IN')}`;
}

function closeSellingBillModal() {
  document.getElementById('selling-bill-modal')?.classList.add('hidden');
}

function printSellingBill() {
  window.print();
}

function exportCurrentBillExcel() {
  if (!state.currentSellingBill?.bill?.id) return;
  window.open(`/api/selling/bills/${encodeURIComponent(state.currentSellingBill.bill.id)}/export-excel`, '_blank');
}

function shareBillWhatsApp() {
  if (!state.currentSellingBill?.bill) return;
  const b = state.currentSellingBill.bill;
  const buyer = state.currentSellingBill.buyer;

  const msg = `*FRESH BLOOMS WHOLESALE FLOWER MANDI*\n` +
    `*Bill No:* ${b.bill_number}\n` +
    `*Buyer:* ${buyer.name} (${buyer.market_city})\n` +
    `*Period:* ${b.period_from} to ${b.period_to} (${b.billing_cycle_days} Days)\n` +
    `*Total Flowers:* ${b.total_weight_kg} kg\n` +
    `*Current Bill Subtotal:* ₹${Number(b.subtotal_amount).toLocaleString('en-IN')}\n` +
    `*Previous Arrears:* ₹${Number(b.previous_balance || 0).toLocaleString('en-IN')}\n` +
    `*Grand Total Payable:* ₹${Number(b.grand_total).toLocaleString('en-IN')}\n` +
    `*Amount Received:* ₹${Number(b.amount_paid || 0).toLocaleString('en-IN')}\n` +
    `*Balance Due:* ₹${Number(b.balance_due || 0).toLocaleString('en-IN')}\n\n` +
    `_Bank: SBI A/c 38920192847 IFSC: SBIN0001234 • UPI: freshblooms@sbi_`;

  const phone = (buyer.phone || '').replace(/[^0-9]/g, '');
  const url = phone ? `https://wa.me/91${phone}?text=${encodeURIComponent(msg)}` : `https://wa.me/?text=${encodeURIComponent(msg)}`;
  window.open(url, '_blank');
}

// --- BUYER PAYMENT RECORDING ---

function openRecordBuyerPayment(buyerId) {
  const buyer = state.buyers.find(b => b.id === buyerId);
  if (!buyer) return;

  document.getElementById('buyer-pay-buyer-id').value = buyer.id;
  document.getElementById('buyer-pay-bill-id').value = '';
  document.getElementById('buyer-pay-name').textContent = `${buyer.name} (${buyer.market_city})`;
  document.getElementById('buyer-pay-balance').textContent = `₹${Number(buyer.current_balance).toLocaleString('en-IN')}`;
  document.getElementById('buyer-pay-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('buyer-pay-amount').value = Math.max(0, buyer.current_balance || 0);

  document.getElementById('buyer-payment-modal')?.classList.remove('hidden');
}

function openRecordBillPaymentModal(billId = null) {
  const id = billId || state.currentSellingBill?.bill?.id;
  if (!id) return;

  const bill = state.sellingBills.find(b => b.id === id) || state.currentSellingBill?.bill;
  const buyerId = bill.buyer_id;
  const buyer = state.buyers.find(b => b.id === buyerId) || state.currentSellingBill?.buyer || {};

  document.getElementById('buyer-pay-buyer-id').value = buyerId;
  document.getElementById('buyer-pay-bill-id').value = id;
  document.getElementById('buyer-pay-name').textContent = `${buyer.name || bill.buyer_name} (Bill #${bill.bill_number})`;
  document.getElementById('buyer-pay-balance').textContent = `₹${Number(bill.balance_due || buyer.current_balance || 0).toLocaleString('en-IN')}`;
  document.getElementById('buyer-pay-date').value = new Date().toISOString().split('T')[0];
  document.getElementById('buyer-pay-amount').value = Math.max(0, bill.balance_due || 0);

  document.getElementById('buyer-payment-modal')?.classList.remove('hidden');
}

function closeBuyerPaymentModal() {
  document.getElementById('buyer-payment-modal')?.classList.add('hidden');
}

async function handleBuyerPaymentSubmit(e) {
  e.preventDefault();
  const buyerId = document.getElementById('buyer-pay-buyer-id').value;
  const billId = document.getElementById('buyer-pay-bill-id').value;
  const payment_date = document.getElementById('buyer-pay-date').value;
  const amount = parseFloat(document.getElementById('buyer-pay-amount').value);
  const payment_mode = document.getElementById('buyer-pay-mode').value;
  const reference_number = document.getElementById('buyer-pay-ref').value.trim();
  const notes = document.getElementById('buyer-pay-notes').value.trim();

  const btn = document.getElementById('btn-save-buyer-payment');
  if (btn) btn.disabled = true;

  try {
    const url = billId ? `/api/selling/bills/${encodeURIComponent(billId)}/payment` : `/api/buyers/${encodeURIComponent(buyerId)}/payment`;
    const res = await authFetch(url, {
      method: 'POST',
      body: JSON.stringify({ payment_date, amount, payment_mode, reference_number, notes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Payment recording failed');

    showToast(`Payment of ₹${amount.toLocaleString('en-IN')} recorded successfully!`, 'success');
    closeBuyerPaymentModal();
    if (billId && state.currentSellingBill?.bill?.id === billId) {
      openSellingBillModal(billId);
    }
    fetchBuyersList();
    fetchSellingBillsList();
  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

// --- FARMER SETTLEMENT STATEMENT (15, 20, 30 DAYS & COMMISSION %) ---

async function openFarmerStatementModal(farmerId) {
  try {
    state.currentStatementFarmerId = farmerId;
    const res = await authFetch(`/api/farmers/${encodeURIComponent(farmerId)}/billing-statement`);
    if (!res.ok) throw new Error('Failed to load farmer statement');

    const data = await res.json();
    state.currentFarmerStatement = data;

    const f = data.farmer;
    const s = data.summary;
    const cols = data.collections || [];

    document.getElementById('stmt-farmer-sub').textContent =
      `${f.full_name} (${f.id}) • ${f.village} • Settlement Cycle: ${f.billing_cycle_days || 15} Days • Commission: ${f.commission_rate ?? 10}%`;

    document.getElementById('stmt-cycle-days').textContent = `${f.billing_cycle_days || 15} Days`;
    document.getElementById('stmt-commission-rate').textContent = `${f.commission_rate ?? 10}%`;
    document.getElementById('stmt-gross-amount').textContent = `₹${Number(s.gross_harvest).toLocaleString('en-IN')}`;
    document.getElementById('stmt-total-kg').textContent = `${s.total_kg} kg supplied`;
    document.getElementById('stmt-commission-amount').textContent = `₹${Number(s.total_commission).toLocaleString('en-IN')}`;
    document.getElementById('stmt-net-payout').textContent = `₹${Number(s.net_farmer_payout).toLocaleString('en-IN')}`;
    document.getElementById('stmt-paid-pending').textContent = `₹${Number(s.paid_payout).toLocaleString('en-IN')} Paid • ₹${Number(s.pending_payout).toLocaleString('en-IN')} Due`;

    const tbody = document.getElementById('farmer-statement-tbody');
    if (tbody) {
      if (cols.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #94A3B8; padding: 24px;">No flower collections recorded for this farmer yet.</td></tr>`;
      } else {
        tbody.innerHTML = cols.map(c => `
          <tr>
            <td><span class="badge-code">${c.id}</span></td>
            <td>${escapeHtml(c.collection_date)}</td>
            <td>${escapeHtml(c.flower_type)} ${c.variety ? `<small>(${escapeHtml(c.variety)})</small>` : ''}</td>
            <td><strong>${c.quantity_kg} kg</strong></td>
            <td>₹${c.rate_per_kg}</td>
            <td>₹${Number(c.gross_amount).toLocaleString('en-IN')}</td>
            <td>${c.commission_rate}%</td>
            <td class="text-rose">₹${Number(c.commission_amount).toLocaleString('en-IN')}</td>
            <td><strong class="text-green">₹${Number(c.net_amount).toLocaleString('en-IN')}</strong></td>
            <td><span class="badge-tag ${c.payment_status === 'Paid' ? 'paid' : 'pending'}">${c.payment_status}</span></td>
          </tr>
        `).join('');
      }
    }

    document.getElementById('farmer-statement-modal')?.classList.remove('hidden');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function closeFarmerStatementModal() {
  document.getElementById('farmer-statement-modal')?.classList.add('hidden');
}

function exportCurrentFarmerStatementCsv() {
  if (!state.currentStatementFarmerId) return;
  window.open(`/api/farmers/${encodeURIComponent(state.currentStatementFarmerId)}/export-statement-csv`, '_blank');
}

// --- EXCEL & CSV BULK IMPORTS ---

let selectedImportFile = null;

function openExcelImportModal() {
  selectedImportFile = null;
  const fileNameEl = document.getElementById('import-file-name');
  if (fileNameEl) fileNameEl.textContent = 'No file chosen yet';
  const statusBox = document.getElementById('import-status-box');
  if (statusBox) statusBox.className = 'hidden';
  onImportTypeChange(document.getElementById('import-entity-type')?.value || 'buyers');
  document.getElementById('excel-import-modal')?.classList.remove('hidden');
}

function closeExcelImportModal() {
  document.getElementById('excel-import-modal')?.classList.add('hidden');
}

function onImportTypeChange(type) {
  const hintEl = document.getElementById('import-format-hint');
  if (!hintEl) return;
  if (type === 'buyers') {
    hintEl.textContent = 'Columns: name, phone, market_city, billing_cycle_days (5 or 6), credit_limit';
  } else if (type === 'distributions') {
    hintEl.textContent = 'Columns: buyer_name, procurement_origin, flower_type, weight_kg, rate_per_kg, coolie_charge';
  } else if (type === 'farmers') {
    hintEl.textContent = 'Columns: full_name, contact_number, village, billing_cycle_days (15, 20, 30), commission_rate (10)';
  } else {
    hintEl.textContent = 'Columns: farmer_name, flower_type, quantity_kg, rate_per_kg, payment_status';
  }
}

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;
  selectedImportFile = file;
  const fileNameEl = document.getElementById('import-file-name');
  if (fileNameEl) fileNameEl.textContent = `Selected: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
}

function downloadSampleTemplate() {
  const type = document.getElementById('import-entity-type')?.value || 'buyers';
  let csvContent = '';
  let filename = `sample_${type}.csv`;

  if (type === 'buyers') {
    csvContent = `name,contact_person,phone,market_city,billing_cycle_days,credit_limit,address\n` +
      `"Kalyani Flower Stores","K. Kalyanaraman","9840123456","Koyambedu Market, Chennai",6,50000,"Stall 42 Koyambedu"\n` +
      `"Murugan Floral Traders","M. Murugan","9840234567","Mattuthavani Market, Madurai",5,40000,"Stall 18 Madurai"`;
  } else if (type === 'distributions') {
    csvContent = `buyer_name,distribution_date,procurement_origin,flower_type,variety,weight_kg,rate_per_kg,coolie_charge,transport_charge,vehicle_number\n` +
      `"Kalyani Flower Stores","2026-10-30","Thovalai","Jasmine","Grade A Mogra",40.0,450,150,200,"TN-74-E-1234"\n` +
      `"Murugan Floral Traders","2026-10-30","Nilakottai","Rose","Red Button",60.0,220,180,250,"TN-57-B-5678"`;
  } else if (type === 'farmers') {
    csvContent = `full_name,contact_number,village,billing_cycle_days,commission_rate,notes\n` +
      `"A. Palanivel","9842100001","Thovalai",15,10.0,"Mogra Jasmine 2 acres"\n` +
      `"S. Ramasamy","9842100002","Nilakottai",20,10.0,"Button Rose 3 acres"\n` +
      `"M. Selvam","9842100003","Hosur",30,12.0,"Dutch Rose greenhouse"`;
  } else {
    csvContent = `farmer_id,collection_date,flower_type,variety,quantity_kg,rate_per_kg,payment_status\n` +
      `"FAR-1001","2026-10-30","Jasmine","Grade A",25.0,380,"Pending"`;
  }

  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function executeDataImport() {
  if (!selectedImportFile) {
    showToast('Please select a CSV or Excel file to upload.', 'warn');
    return;
  }

  const type = document.getElementById('import-entity-type')?.value || 'buyers';
  const statusBox = document.getElementById('import-status-box');
  const btn = document.getElementById('btn-submit-import');

  if (btn) btn.disabled = true;

  try {
    const text = await selectedImportFile.text();
    const rows = parseCsvText(text);

    if (rows.length === 0) {
      throw new Error('CSV file is empty or headers could not be parsed.');
    }

    const payloadKey = type === 'farmers' ? 'farmers' : type === 'buyers' ? 'buyers' : type === 'distributions' ? 'distributions' : 'collections';

    const res = await authFetch(`/api/import/${type}`, {
      method: 'POST',
      body: JSON.stringify({ [payloadKey]: rows })
    });
    const result = await res.json();
    if (!res.ok) throw new Error(result.error || 'Import failed');

    statusBox.className = 'calc-highlight-box';
    statusBox.style.color = '#15803D';
    statusBox.innerHTML = `<strong>Import Successful!</strong> Successfully processed ${result.importedCount || result.imported || rows.length} records into ${type}.`;

    showToast(`Bulk imported ${result.importedCount || result.imported || rows.length} records!`, 'success');

    // Refresh view
    if (type === 'buyers') fetchBuyersList();
    else if (type === 'distributions') fetchDistributionsList();
    else if (type === 'farmers') fetchFarmersList();
    else if (type === 'collections') fetchCollectionsList();

  } catch (err) {
    statusBox.className = 'calc-highlight-box';
    statusBox.style.color = '#DC2626';
    statusBox.innerHTML = `<strong>Import Error:</strong> ${escapeHtml(err.message)}`;
    showToast(err.message, 'error');
  } finally {
    if (btn) btn.disabled = false;
  }
}

function parseCsvText(csv) {
  const lines = csv.split(/\r\n|\n/).filter(l => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = lines[0].split(',').map(h => h.trim().replace(/^["']|["']$/g, ''));
  const data = [];

  for (let i = 1; i < lines.length; i++) {
    const rawCols = lines[i].split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/);
    const obj = {};
    headers.forEach((h, idx) => {
      let val = rawCols[idx] ? rawCols[idx].trim().replace(/^["']|["']$/g, '') : '';
      obj[h] = val;
    });
    data.push(obj);
  }
  return data;
}

// =========================================================
// 9. UTILITIES & PAGINATION
// =========================================================
async function authFetch(url, options = {}) {
  options.headers = options.headers || {};
  if (state.token) {
    options.headers['Authorization'] = `Bearer ${state.token}`;
  }
  if (options.body && typeof options.body === 'string' && !options.headers['Content-Type']) {
    options.headers['Content-Type'] = 'application/json';
  }
  return fetch(url, options);
}

function renderPaginationControls(containerId, pagination, onPageChange) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (pagination.totalPages <= 1) {
    container.innerHTML = `<span>Page ${pagination.page} of 1 (${pagination.total} records)</span>`;
    return;
  }

  container.innerHTML = `
    <span>Showing page ${pagination.page} of ${pagination.totalPages} (${pagination.total} records)</span>
    <div class="pagination-controls">
      <button class="btn btn-outline btn-xs" ${pagination.page <= 1 ? 'disabled' : ''} id="${containerId}-prev">
        ← Previous
      </button>
      <button class="btn btn-outline btn-xs" ${pagination.page >= pagination.totalPages ? 'disabled' : ''} id="${containerId}-next">
        Next →
      </button>
    </div>
  `;

  document.getElementById(`${containerId}-prev`)?.addEventListener('click', () => onPageChange(pagination.page - 1));
  document.getElementById(`${containerId}-next`)?.addEventListener('click', () => onPageChange(pagination.page + 1));
}

function formatDate(isoStr) {
  if (!isoStr) return '—';
  try {
    const d = new Date(isoStr);
    return d.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch (e) {
    return isoStr;
  }
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  const icon = type === 'success' ? '✓' : type === 'error' ? '✕' : type === 'warn' ? '⚠️' : 'ℹ️';
  toast.innerHTML = `<span>${icon}</span> <span>${message}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateX(50px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}
