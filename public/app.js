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
  syncInterval: null
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
        </td>
        <td>${escapeHtml(f.contact_number)}</td>
        <td>${escapeHtml(f.village)}</td>
        <td><span class="badge-tag ${locStatus}">${escapeHtml(locStatusLabel)}</span></td>
        <td><strong>${totalKg} kg</strong></td>
        <td><strong>₹${totalPayout}</strong></td>
        <td>${escapeHtml(f.last_collection_date || '—')}</td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-outline btn-xs" onclick="openFarmerProfileModal('${escapeHtml(f.id)}')" title="View Full Profile">${btnProfile}</button>
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
      body: JSON.stringify({ full_name, name_ta, contact_number, village, address, latitude, longitude, notes })
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
