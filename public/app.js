/* =========================================================
   FRESH BLOOMS - APPLICATION LOGIC & CONTROLLER
   Flower Shop Billing & Customer Management System
   ========================================================= */

// Global State
const state = {
  token: localStorage.getItem('fb_token') || null,
  user: JSON.parse(localStorage.getItem('fb_user') || 'null'),
  currentView: 'dashboard',
  customers: [],
  flowers: [],
  selectedCustomer: null,
  currentInvoice: null,
  dashboardData: null,
  dashboardChart: null,
  salesTrendChart: null,
  flowerDistributionChart: null,
  pinBuffer: ''
};

// --- INITIALIZATION ---
document.addEventListener('DOMContentLoaded', () => {
  initApp();
  setInterval(updateLiveDateTime, 1000);
});

function initApp() {
  if (state.token && state.user) {
    showWorkspace();
    setupUserInterface();
    fetchInitialData();
  } else {
    showLogin();
  }
}

function updateLiveDateTime() {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
  
  const navDate = document.getElementById('nav-current-date');
  if (navDate) navDate.textContent = now.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });

  const billDateTime = document.getElementById('live-bill-datetime');
  if (billDateTime) billDateTime.textContent = `${dateStr} | ${timeStr}`;

  const dashDate = document.getElementById('dashboard-date-str');
  if (dashDate) dashDate.textContent = now.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
}

// --- AUTHENTICATION & LOGIN ---
const loginForm = document.getElementById('login-form');
if (loginForm) {
  loginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const btn = document.getElementById('btn-submit-login');
    btn.disabled = true;
    btn.textContent = 'Verifying...';

    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Login failed');

      onLoginSuccess(data);
    } catch (err) {
      showToast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.innerHTML = `<span>Login to Dashboard</span> <span class="arrow">→</span>`;
    }
  });
}

// Password toggle
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

function quickFillLogin(username, password) {
  document.getElementById('login-username').value = username;
  document.getElementById('login-password').value = password;
  
  // Update pill active style
  document.querySelectorAll('.demo-pill').forEach(p => p.classList.remove('active'));
  if (event && event.currentTarget) event.currentTarget.classList.add('active');
  
  // Submit immediately for effortless demo
  loginForm.dispatchEvent(new Event('submit'));
}

function onLoginSuccess(data) {
  state.token = data.token;
  state.user = data.user;
  localStorage.setItem('fb_token', data.token);
  localStorage.setItem('fb_user', JSON.stringify(data.user));

  showToast(`Welcome, ${data.user.name}! (${data.user.role})`, 'success');
  showWorkspace();
  setupUserInterface();
  fetchInitialData();
  closePinModal();
}

function logout() {
  state.token = null;
  state.user = null;
  localStorage.removeItem('fb_token');
  localStorage.removeItem('fb_user');
  showLogin();
  showToast('Logged out successfully', 'info');
}

// Switch Role from Top Navigation (For fast demo evaluation)
async function switchRole(newRole) {
  const roleAccounts = {
    admin: { user: 'admin', pw: 'admin123' },
    manager: { user: 'manager', pw: 'admin123' },
    cashier: { user: 'cashier', pw: 'admin123' },
    stock_manager: { user: 'stockmgr', pw: 'admin123' }
  };
  const target = roleAccounts[newRole];
  if (!target) return;

  try {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: target.user, password: target.pw })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    onLoginSuccess(data);
  } catch (err) {
    showToast('Failed to switch role: ' + err.message, 'error');
  }
}

// Staff PIN login
document.getElementById('btn-open-pin-login').addEventListener('click', () => {
  state.pinBuffer = '';
  updatePinDots();
  document.getElementById('pin-login-modal').classList.remove('hidden');
});

function closePinModal() {
  document.getElementById('pin-login-modal').classList.add('hidden');
  state.pinBuffer = '';
}

function pressPin(digit) {
  if (state.pinBuffer.length < 4) {
    state.pinBuffer += digit;
    updatePinDots();
    if (state.pinBuffer.length === 4) {
      submitPinLogin(state.pinBuffer);
    }
  }
}

function clearPin() {
  state.pinBuffer = '';
  updatePinDots();
}

function backspacePin() {
  if (state.pinBuffer.length > 0) {
    state.pinBuffer = state.pinBuffer.slice(0, -1);
    updatePinDots();
  }
}

function updatePinDots() {
  for (let i = 0; i < 4; i++) {
    const dot = document.getElementById(`dot-0`.replace('0', i));
    if (dot) {
      if (i < state.pinBuffer.length) dot.classList.add('filled');
      else dot.classList.remove('filled');
    }
  }
}

async function submitPinLogin(pin) {
  try {
    const res = await fetch('/api/auth/pin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Invalid PIN');

    onLoginSuccess(data);
  } catch (err) {
    showToast(err.message, 'error');
    clearPin();
  }
}

// --- WORKSPACE & ROLE PERMISSIONS ---
function showLogin() {
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('app-workspace').classList.add('hidden');
}

function showWorkspace() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-workspace').classList.remove('hidden');
}

function setupUserInterface() {
  if (!state.user) return;

  // Sidebar profile
  document.getElementById('sidebar-user-name').textContent = state.user.name;
  document.getElementById('sidebar-user-avatar').textContent = state.user.name.charAt(0).toUpperCase();
  document.getElementById('sidebar-user-role').textContent = state.user.role.replace('_', ' ');

  // Dropdown selector sync
  const roleSelect = document.getElementById('active-role-selector');
  if (roleSelect) roleSelect.value = state.user.role;

  // Role permissions enforcement
  const role = state.user.role;
  const adminElements = document.querySelectorAll('.admin-only');

  if (role === 'admin') {
    adminElements.forEach(el => el.classList.remove('hidden'));
    document.getElementById('nav-new-bill').classList.remove('hidden');
  } else if (role === 'manager') {
    adminElements.forEach(el => el.classList.add('hidden'));
    document.getElementById('nav-staff').classList.remove('hidden'); // Managers can see staff
    document.getElementById('nav-new-bill').classList.remove('hidden');
  } else if (role === 'cashier') {
    adminElements.forEach(el => el.classList.add('hidden'));
    document.getElementById('nav-new-bill').classList.remove('hidden');
    // Cashier cannot view reports
    document.getElementById('nav-reports').classList.add('hidden');
  } else if (role === 'stock_manager') {
    adminElements.forEach(el => el.classList.add('hidden'));
    // Stock manager cannot generate bills or see reports
    document.getElementById('nav-new-bill').classList.add('hidden');
    document.getElementById('nav-reports').classList.add('hidden');
  }

  // If currently on a forbidden view, redirect to dashboard or inventory
  if (role === 'stock_manager' && (state.currentView === 'new-bill' || state.currentView === 'reports')) {
    navigateTo('inventory');
  } else {
    navigateTo(state.currentView || 'dashboard');
  }
}

// Navigation Router
function navigateTo(viewId) {
  // Permission guard
  if (state.user && state.user.role === 'stock_manager' && (viewId === 'new-bill' || viewId === 'reports')) {
    showToast('Access denied: Stock Managers cannot access billing or financial reports', 'warn');
    return;
  }
  if (state.user && state.user.role === 'cashier' && (viewId === 'reports' || viewId === 'staff' || viewId === 'settings')) {
    showToast('Access denied: Cashiers cannot access owner reports or settings', 'warn');
    return;
  }

  state.currentView = viewId;

  // Update sidebar active buttons
  document.querySelectorAll('.sidebar-nav .nav-item').forEach(item => {
    if (item.dataset.view === viewId) item.classList.add('active');
    else item.classList.remove('active');
  });

  // Toggle view containers
  document.querySelectorAll('.app-view').forEach(view => {
    if (view.id === `view-${viewId}`) view.classList.remove('hidden');
    else view.classList.add('hidden');
  });

  // Close mobile sidebar if open
  document.querySelector('.sidebar').classList.remove('mobile-open');

  // Trigger view data refreshes
  if (viewId === 'dashboard') fetchDashboardData();
  else if (viewId === 'new-bill') initNewBillForm();
  else if (viewId === 'customers') fetchCustomers();
  else if (viewId === 'inventory') { fetchFlowers(); fetchStockMovements(); }
  else if (viewId === 'payments') fetchPayments();
  else if (viewId === 'reports') fetchReportsSummary();
  else if (viewId === 'staff') fetchStaffList();
  else if (viewId === 'settings') fetchSettings();
  else if (viewId === 'audit') fetchAuditLogs();
}

function toggleSidebar() {
  document.querySelector('.sidebar').classList.toggle('mobile-open');
}

// Global Search
function handleGlobalSearch(term) {
  if (!term || term.trim() === '') return;
  term = term.toLowerCase().trim();

  // If searching on customers page, filter customer list
  if (state.currentView === 'customers') {
    filterCustomerTable(term);
  } else if (state.currentView === 'inventory') {
    // Filter inventory rows
    document.querySelectorAll('#inventory-tbody tr').forEach(row => {
      const text = row.textContent.toLowerCase();
      row.style.display = text.includes(term) ? '' : 'none';
    });
  } else {
    // Jump to customers with search
    navigateTo('customers');
    document.getElementById('customer-table-search').value = term;
    filterCustomerTable(term);
  }
}

// --- FETCH INITIAL APPLICATION DATA ---
async function fetchInitialData() {
  await Promise.all([
    fetchDashboardData(),
    fetchFlowers(),
    fetchCustomers()
  ]);
}

// =========================================================
// 1. DASHBOARD CONTROLLER & CHARTS
// =========================================================
async function fetchDashboardData() {
  try {
    const res = await authFetch('/api/dashboard/summary');
    if (!res.ok) return;
    const data = await res.json();
    state.dashboardData = data;

    // Update KPI Cards
    document.getElementById('kpi-sales').textContent = `₹${data.todaySales.toLocaleString('en-IN')}`;
    document.getElementById('kpi-bills').textContent = data.totalBills;
    document.getElementById('kpi-cash').textContent = `₹${data.todayCash.toLocaleString('en-IN')}`;
    document.getElementById('kpi-upi').textContent = `₹${data.todayUpi.toLocaleString('en-IN')}`;
    document.getElementById('kpi-credit').textContent = `₹${data.todayCredit.toLocaleString('en-IN')}`;
    document.getElementById('kpi-debt').textContent = `₹${data.outstandingBalance.toLocaleString('en-IN')}`;
    document.getElementById('kpi-debt-customers').textContent = `${data.customersWithDebt} customers`;
    document.getElementById('kpi-weight').textContent = `${data.flowersSoldWeight} kg`;
    document.getElementById('kpi-stock-val').textContent = `₹${data.stockValue.toLocaleString('en-IN')}`;

    // Render Chart
    renderSalesOverviewChart(data.recentDays);

    // Render Top Selling Flowers list
    renderTopSellingFlowers(data.topSellingFlowers);

    // Render Best Customers leaderboard
    renderBestCustomers(data.bestCustomers);

  } catch (err) {
    console.error('Error fetching dashboard:', err);
  }
}

function renderSalesOverviewChart(recentDays) {
  const ctx = document.getElementById('salesOverviewChart');
  if (!ctx) return;

  const labels = recentDays.map(d => d.label);
  const salesData = recentDays.map(d => d.sales);

  if (state.dashboardChart) {
    state.dashboardChart.destroy();
  }

  state.dashboardChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Daily Sales (₹)',
        data: salesData,
        backgroundColor: '#15803D',
        borderRadius: 6,
        hoverBackgroundColor: '#166534',
        barThickness: 28
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => ` Sales: ₹${ctx.parsed.y.toLocaleString('en-IN')}`
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          grid: { color: '#F1F5F9' },
          ticks: {
            callback: (val) => `₹${val >= 1000 ? (val / 1000) + 'k' : val}`
          }
        },
        x: {
          grid: { display: false }
        }
      }
    }
  });
}

function setDashboardChartFilter(type, btn) {
  document.querySelectorAll('.pill-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  if (!state.dashboardData || !state.dashboardChart) return;

  if (type === 'daily') {
    renderSalesOverviewChart(state.dashboardData.recentDays);
  } else if (type === 'weekly') {
    const weeklyData = [
      { label: 'Week 1', sales: 110400 },
      { label: 'Week 2', sales: 135800 },
      { label: 'Week 3', sales: 154200 },
      { label: 'This Week', sales: 168900 }
    ];
    renderSalesOverviewChart(weeklyData);
  } else if (type === 'monthly') {
    const monthlyData = [
      { label: 'May', sales: 420000 },
      { label: 'Jun', sales: 465000 },
      { label: 'Jul', sales: 510000 },
      { label: 'Aug', sales: 590000 },
      { label: 'Sep', sales: 640000 },
      { label: 'Oct', sales: 710000 }
    ];
    renderSalesOverviewChart(monthlyData);
  }
}

function renderTopSellingFlowers(flowers) {
  const container = document.getElementById('dashboard-top-flowers');
  if (!container) return;

  const flowerColors = {
    'Jasmine': '#E05375',
    'Rose': '#E11D48',
    'Marigold': '#D97706',
    'Chrysanthemum': '#059669',
    'Lotus': '#EC4899',
    'Tuberose': '#8B5CF6',
    'Lily': '#3B82F6'
  };

  container.innerHTML = flowers.map(f => `
    <div class="top-list-item">
      <div class="item-left">
        <span class="flower-dot" style="background: ${flowerColors[f.flower_name] || '#15803D'}"></span>
        <div>
          <div class="item-name">${f.flower_name}</div>
          <div class="item-sub">Revenue: ₹${Math.round(f.total_amount).toLocaleString('en-IN')}</div>
        </div>
      </div>
      <div class="item-value">${f.total_weight} kg</div>
    </div>
  `).join('');
}

function renderBestCustomers(customers) {
  const container = document.getElementById('dashboard-best-customers');
  if (!container) return;

  container.innerHTML = customers.map(c => `
    <div class="top-list-item" style="cursor: pointer" onclick="viewCustomerDetail('${c.id}')">
      <div class="item-left">
        <div class="user-avatar" style="width: 28px; height: 28px; font-size: 0.75rem;">${c.name.charAt(0)}</div>
        <div>
          <div class="item-name">${c.name}</div>
          <div class="item-sub">${c.category}</div>
        </div>
      </div>
      <div class="item-value text-green">₹${c.total_purchased.toLocaleString('en-IN')}</div>
    </div>
  `).join('');
}

// =========================================================
// 2. BILLING & NEW BILL SYSTEM
// =========================================================
function initNewBillForm() {
  // Generate next expected invoice number preview
  updateLiveDateTime();
  fetchLiveInvoiceNumber();

  // If table is empty, add 3 default rows matching screenshot
  const tbody = document.getElementById('bill-items-tbody');
  if (tbody.children.length === 0) {
    addBillingItemRow('Jasmine', 'Mogra', 5.0, 400);
    addBillingItemRow('Rose', 'Red Rose', 3.0, 250);
    addBillingItemRow('Marigold', 'Local Yellow', 2.0, 180);
  }
  recalculateBillTotals();
}

async function fetchLiveInvoiceNumber() {
  try {
    const res = await authFetch('/api/settings');
    if (res.ok) {
      const settings = await res.json();
      const prefix = settings.invoice_prefix || 'FB';
      const nextNum = settings.next_invoice_num || '1568';
      const invNo = `${prefix}${String(nextNum).padStart(6, '0')}`;
      const elem = document.getElementById('live-invoice-no');
      if (elem) elem.textContent = invNo;
    }
  } catch (e) {
    console.error(e);
  }
}

// Dynamic Billing Item Row
function addBillingItemRow(defaultName = '', defaultVariety = '', defaultWeight = 1, defaultRate = 0) {
  const tbody = document.getElementById('bill-items-tbody');
  const rowId = `item-row-${Date.now()}-${Math.random().toString(36).substring(2, 5)}`;
  const tr = document.createElement('tr');
  tr.id = rowId;

  // Build flower select options
  const flowerOptions = state.flowers.map(f => `
    <option value="${f.id}" data-name="${f.name}" data-variety="${f.variety}" data-rate="${f.selling_rate}" data-stock="${f.available_stock}" ${f.name === defaultName ? 'selected' : ''}>
      ${f.name} (${f.variety}) - Avail: ${f.available_stock}kg
    </option>
  `).join('');

  tr.innerHTML = `
    <td>
      <select class="item-flower-select" onchange="onRowFlowerSelect('${rowId}', this)">
        <option value="">-- Choose Flower --</option>
        ${flowerOptions}
      </select>
    </td>
    <td>
      <input type="text" class="item-variety" value="${defaultVariety}" placeholder="Variety">
    </td>
    <td>
      <div style="display: flex; gap: 4px; align-items: center;">
        <input type="number" class="item-weight" value="${defaultWeight}" min="0.01" step="0.1" oninput="onRowWeightOrRateChange('${rowId}')" style="width: 80px;">
        <span style="font-size: 0.8rem; color: #64748B;">kg</span>
      </div>
    </td>
    <td>
      <div style="display: flex; gap: 4px; align-items: center;">
        <span style="font-size: 0.85rem; color: #64748B;">₹</span>
        <input type="number" class="item-rate" value="${defaultRate || 400}" min="0" step="1" oninput="onRowWeightOrRateChange('${rowId}')" style="width: 85px;">
      </div>
    </td>
    <td>
      <strong class="item-amount" style="font-size: 0.95rem; color: #15803D;">₹0</strong>
    </td>
    <td>
      <button type="button" class="btn-remove-row" onclick="removeBillingItemRow('${rowId}')" title="Remove">✕</button>
    </td>
  `;

  tbody.appendChild(tr);

  // If defaults provided, select matched flower
  if (defaultName) {
    const select = tr.querySelector('.item-flower-select');
    const opt = Array.from(select.options).find(o => o.dataset.name === defaultName);
    if (opt) {
      select.value = opt.value;
      if (!defaultRate) tr.querySelector('.item-rate').value = opt.dataset.rate;
      if (!defaultVariety) tr.querySelector('.item-variety').value = opt.dataset.variety;
    }
  }

  onRowWeightOrRateChange(rowId);
}

function removeBillingItemRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) row.remove();
  recalculateBillTotals();
}

function onRowFlowerSelect(rowId, selectElem) {
  const tr = document.getElementById(rowId);
  if (!tr) return;
  const selectedOpt = selectElem.options[selectElem.selectedIndex];
  if (selectedOpt && selectedOpt.value) {
    tr.querySelector('.item-variety').value = selectedOpt.dataset.variety || '';
    tr.querySelector('.item-rate').value = selectedOpt.dataset.rate || 0;
    onRowWeightOrRateChange(rowId);
  }
}

function onRowWeightOrRateChange(rowId) {
  const tr = document.getElementById(rowId);
  if (!tr) return;
  const weight = parseFloat(tr.querySelector('.item-weight').value) || 0;
  const rate = parseFloat(tr.querySelector('.item-rate').value) || 0;
  const amount = Math.round(weight * rate * 100) / 100;

  tr.querySelector('.item-amount').textContent = `₹${amount.toLocaleString('en-IN')}`;
  recalculateBillTotals();
}

function recalculateBillTotals() {
  const rows = document.querySelectorAll('#bill-items-tbody tr');
  let subtotal = 0;

  rows.forEach(tr => {
    const weight = parseFloat(tr.querySelector('.item-weight')?.value) || 0;
    const rate = parseFloat(tr.querySelector('.item-rate')?.value) || 0;
    subtotal += (weight * rate);
  });

  const discount = Math.max(0, parseFloat(document.getElementById('bill-discount-input')?.value) || 0);
  const addCharges = Math.max(0, parseFloat(document.getElementById('bill-charges-input')?.value) || 0);

  const totalAmount = Math.max(0, Math.round((subtotal - discount + addCharges) * 100) / 100);

  document.getElementById('bill-subtotal-display').textContent = `₹${subtotal.toLocaleString('en-IN')}`;
  document.getElementById('bill-total-display').textContent = `₹${totalAmount.toLocaleString('en-IN')}`;
  document.getElementById('btn-bill-total-badge').textContent = `₹${totalAmount.toLocaleString('en-IN')}`;

  // If received input is untouched or matching, default to total
  const receivedInput = document.getElementById('bill-received-input');
  const selectedPayMethod = document.querySelector('input[name="payMethod"]:checked')?.value || 'Cash';

  let received = parseFloat(receivedInput.value);
  if (selectedPayMethod === 'Credit') {
    // If credit, amount received is 0 by default
    if (isNaN(received) || received === totalAmount) {
      received = 0;
      receivedInput.value = 0;
    }
  } else {
    if (isNaN(received) || received === 0 || receivedInput.dataset.autoFilled === 'true') {
      received = totalAmount;
      receivedInput.value = totalAmount;
      receivedInput.dataset.autoFilled = 'true';
    }
  }

  const balanceDue = Math.max(0, Math.round((totalAmount - received) * 100) / 100);
  const balDisplay = document.getElementById('bill-balance-display');
  balDisplay.textContent = `₹${balanceDue.toLocaleString('en-IN')}`;
  if (balanceDue > 0) {
    balDisplay.className = 'text-rose';
  } else {
    balDisplay.className = 'balance-zero';
  }
}

// Payment method chips
function onPaymentMethodSelect(method) {
  document.querySelectorAll('.pay-pill').forEach(pill => {
    const radio = pill.querySelector('input');
    if (radio.value === method) pill.classList.add('active');
    else pill.classList.remove('active');
  });

  const receivedInput = document.getElementById('bill-received-input');
  if (method === 'Credit') {
    receivedInput.value = 0;
    delete receivedInput.dataset.autoFilled;
  } else {
    delete receivedInput.dataset.autoFilled;
  }
  recalculateBillTotals();
}

// Autocomplete customer search in billing
function onCustomerSearchInput(val) {
  const dropdown = document.getElementById('customer-dropdown-results');
  if (!val || val.trim().length === 0) {
    dropdown.classList.add('hidden');
    return;
  }
  const term = val.toLowerCase().trim();
  const matched = state.customers.filter(c =>
    c.name.toLowerCase().includes(term) ||
    c.mobile.includes(term) ||
    (c.shop_name && c.shop_name.toLowerCase().includes(term))
  );

  if (matched.length === 0) {
    dropdown.innerHTML = `
      <div class="dropdown-item" onclick="openNewCustomerModal('${val}')">
        <span>+ Add "<strong>${val}</strong>" as New Customer</span>
      </div>
    `;
  } else {
    dropdown.innerHTML = matched.map(c => `
      <div class="dropdown-item" onclick="selectBillingCustomer('${c.id}')">
        <div>
          <strong>${c.name}</strong> <span style="color: #64748B;">(${c.mobile})</span>
          ${c.shop_name ? `<div style="font-size: 0.75rem; color: #94A3B8;">${c.shop_name}</div>` : ''}
        </div>
        <div style="text-align: right;">
          <span class="badge-cat ${c.category.replace(/\s+/g, '')}">${c.category}</span>
          ${c.outstanding > 0 ? `<div style="font-size: 0.75rem; color: #E11D48; font-weight: 700;">Bal: ₹${c.outstanding}</div>` : ''}
        </div>
      </div>
    `).join('');
  }
  dropdown.classList.remove('hidden');
}

function selectBillingCustomer(customerId) {
  const cust = state.customers.find(c => c.id === customerId);
  if (!cust) return;

  state.selectedCustomer = cust;
  document.getElementById('bill-customer-search').value = `${cust.name} (${cust.mobile})`;
  document.getElementById('bill-customer-category').value = cust.category;
  document.getElementById('customer-dropdown-results').classList.add('hidden');

  // Update credit indicator
  document.getElementById('bill-cust-outstanding').textContent = `₹${cust.outstanding.toLocaleString('en-IN')}`;
  document.getElementById('bill-cust-stats').textContent = `Lifetime: ${cust.total_weight} kg purchased (₹${cust.total_purchased.toLocaleString('en-IN')})`;

  if (cust.outstanding > 0) {
    showToast(`Note: ${cust.name} has an outstanding credit balance of ₹${cust.outstanding}`, 'warn');
  }
}

// Generate Bill submission handler
async function handleGenerateBill(e) {
  e.preventDefault();

  const customerSearchVal = document.getElementById('bill-customer-search').value.trim();
  if (!customerSearchVal) {
    showToast('Please enter customer name or mobile number', 'warn');
    return;
  }

  // Parse name & mobile
  let customerName = customerSearchVal;
  let customerMobile = '9876543210';
  let customerId = state.selectedCustomer ? state.selectedCustomer.id : null;

  if (state.selectedCustomer) {
    customerName = state.selectedCustomer.name;
    customerMobile = state.selectedCustomer.mobile;
  } else {
    // Check if entered as "Name (Mobile)" or just name
    const match = customerSearchVal.match(/^(.*?)(?:\s*\((.*?)\))?$/);
    if (match) {
      customerName = match[1].trim();
      customerMobile = match[2] ? match[2].trim() : '9876543210';
    }
  }

  const category = document.getElementById('bill-customer-category').value;
  const payMethod = document.querySelector('input[name="payMethod"]:checked')?.value || 'Cash';
  const discount = parseFloat(document.getElementById('bill-discount-input').value) || 0;
  const additionalCharges = parseFloat(document.getElementById('bill-charges-input').value) || 0;
  const amountReceived = parseFloat(document.getElementById('bill-received-input').value);
  const notes = document.getElementById('bill-notes').value;

  // Collect item rows
  const rows = document.querySelectorAll('#bill-items-tbody tr');
  if (rows.length === 0) {
    showToast('Please add at least one flower item to the bill', 'warn');
    return;
  }

  const items = [];
  for (const tr of rows) {
    const select = tr.querySelector('.item-flower-select');
    const selectedOpt = select.options[select.selectedIndex];
    const flowerId = selectedOpt ? selectedOpt.value : null;
    const flowerName = selectedOpt ? selectedOpt.dataset.name : (select.value || 'Flowers');
    const variety = tr.querySelector('.item-variety').value;
    const weight = parseFloat(tr.querySelector('.item-weight').value);
    const rate = parseFloat(tr.querySelector('.item-rate').value);

    if (!flowerName || isNaN(weight) || weight <= 0 || isNaN(rate) || rate < 0) {
      showToast('Please fill all item weights and rates correctly', 'warn');
      return;
    }

    items.push({
      flower_id: flowerId ? parseInt(flowerId, 10) : null,
      flower_name: flowerName,
      variety: variety || 'Local',
      weight: weight,
      unit: 'kg',
      rate: rate
    });
  }

  const btn = document.getElementById('btn-generate-bill');
  btn.disabled = true;
  btn.innerHTML = `<span>⏳ Processing Invoice...</span>`;

  try {
    const res = await authFetch('/api/invoices', {
      method: 'POST',
      body: JSON.stringify({
        customer_id: customerId,
        customer_name: customerName,
        customer_mobile: customerMobile,
        customer_category: category,
        items,
        discount,
        additional_charges: additionalCharges,
        payment_method: payMethod,
        amount_received: isNaN(amountReceived) ? undefined : amountReceived,
        notes
      })
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Failed to generate bill');

    // Confetti celebration
    if (typeof confetti === 'function') {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.6 }
      });
    }

    showToast(`Bill #${data.invoice.invoice_no} generated successfully!`, 'success');
    state.currentInvoice = data.invoice;

    // Show printable modal
    openInvoiceModal(data.invoice);

    // Refresh stock and customer data in background
    fetchFlowers();
    fetchCustomers();
    fetchDashboardData();

    // Reset bill items for next customer
    resetBillForm();

  } catch (err) {
    showToast(err.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = `<span>⚡ Generate Bill</span> <span class="total-badge" id="btn-bill-total-badge">₹0</span>`;
    recalculateBillTotals();
  }
}

function resetBillForm() {
  state.selectedCustomer = null;
  document.getElementById('bill-customer-search').value = '';
  document.getElementById('bill-cust-outstanding').textContent = '₹0';
  document.getElementById('bill-cust-stats').textContent = 'Lifetime: 0 kg purchased';
  document.getElementById('bill-discount-input').value = 0;
  document.getElementById('bill-charges-input').value = 0;
  document.getElementById('bill-notes').value = '';
  document.getElementById('bill-items-tbody').innerHTML = '';
  addBillingItemRow();
  recalculateBillTotals();
  fetchLiveInvoiceNumber();
}

// =========================================================
// 3. INVOICE PREVIEW & PRINT MODAL
// =========================================================
function openInvoiceModal(invoice) {
  state.currentInvoice = invoice;

  document.getElementById('modal-invoice-no-title').textContent = invoice.invoice_no;
  document.getElementById('inv-doc-no').textContent = invoice.invoice_no;
  document.getElementById('inv-doc-date').textContent = invoice.created_at;
  document.getElementById('inv-doc-cust-name').textContent = invoice.customer_name;
  document.getElementById('inv-doc-cust-mobile').textContent = invoice.customer_mobile;
  document.getElementById('inv-doc-cust-cat').textContent = invoice.customer_category;

  document.getElementById('inv-doc-pay-method').textContent = invoice.payment_method;
  document.getElementById('inv-doc-received').textContent = `₹${invoice.amount_received.toLocaleString('en-IN')}`;
  document.getElementById('inv-doc-balance').textContent = `₹${invoice.balance_due.toLocaleString('en-IN')}`;
  document.getElementById('inv-doc-staff').textContent = `${invoice.created_by} (${invoice.created_by_role})`;

  document.getElementById('inv-doc-subtotal').textContent = `₹${invoice.subtotal.toLocaleString('en-IN')}`;
  document.getElementById('inv-doc-discount').textContent = `₹${invoice.discount.toLocaleString('en-IN')}`;
  document.getElementById('inv-doc-charges').textContent = `₹${invoice.additional_charges.toLocaleString('en-IN')}`;
  document.getElementById('inv-doc-total').textContent = `₹${invoice.total_amount.toLocaleString('en-IN')}`;
  document.getElementById('inv-doc-notes').textContent = invoice.notes || 'Thank you for your business!';

  // Populate items table
  const tbody = document.getElementById('inv-doc-items-tbody');
  tbody.innerHTML = invoice.items.map((it, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td><strong>${it.flower_name}</strong></td>
      <td>${it.variety}</td>
      <td>${it.weight} ${it.unit || 'kg'}</td>
      <td>₹${it.rate}</td>
      <td><strong>₹${it.amount.toLocaleString('en-IN')}</strong></td>
    </tr>
  `).join('');

  document.getElementById('invoice-modal').classList.remove('hidden');
}

function closeInvoiceModal() {
  document.getElementById('invoice-modal').classList.add('hidden');
}

function printInvoiceModal() {
  window.print();
}

function downloadInvoicePDF() {
  showToast('Opening PDF print dialog...', 'info');
  window.print();
}

function shareInvoiceWhatsApp() {
  if (!state.currentInvoice) return;
  const inv = state.currentInvoice;
  const text = `🌸 *Fresh Blooms - Tax Invoice* 🌸\n` +
    `Invoice: *#${inv.invoice_no}*\n` +
    `Customer: ${inv.customer_name}\n` +
    `Total Amount: ₹${inv.total_amount.toLocaleString('en-IN')}\n` +
    `Paid: ₹${inv.amount_received.toLocaleString('en-IN')}\n` +
    `Balance Due: ₹${inv.balance_due.toLocaleString('en-IN')}\n` +
    `Payment Mode: ${inv.payment_method}\n` +
    `Thank you for blooming with Fresh Blooms! 🌺`;

  const phone = inv.customer_mobile.replace(/[^0-9]/g, '');
  const url = `https://wa.me/91${phone}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}

// =========================================================
// 4. CUSTOMER MANAGEMENT & DRAWER
// =========================================================
async function fetchCustomers() {
  try {
    const res = await authFetch('/api/customers');
    if (!res.ok) return;
    state.customers = await res.json();
    renderCustomerTable(state.customers);

    // Auto-select first customer for detail card preview
    if (state.customers.length > 0 && !state.selectedCustomer) {
      viewCustomerDetail(state.customers[0].id);
    }
  } catch (err) {
    console.error(err);
  }
}

function renderCustomerTable(customers) {
  const tbody = document.getElementById('customers-tbody');
  if (!tbody) return;

  tbody.innerHTML = customers.map(c => `
    <tr onclick="viewCustomerDetail('${c.id}')" style="cursor: pointer;">
      <td><span class="badge-code">${c.id}</span></td>
      <td><strong>${c.name}</strong> ${c.shop_name ? `<br><small style="color: #64748B;">${c.shop_name}</small>` : ''}</td>
      <td>${c.mobile}</td>
      <td><span class="badge-cat ${c.category.replace(/\s+/g, '')}">${c.category}</span></td>
      <td><strong>₹${c.total_purchased.toLocaleString('en-IN')}</strong></td>
      <td><strong class="${c.outstanding > 0 ? 'text-rose' : 'text-green'}">₹${c.outstanding.toLocaleString('en-IN')}</strong></td>
      <td>${c.last_purchase_date || '—'}</td>
      <td>
        <button class="btn btn-outline btn-xs" onclick="event.stopPropagation(); startBillForCustomer('${c.id}')">🧾 Bill</button>
      </td>
    </tr>
  `).join('');
}

function filterCustomerTable(term) {
  if (!term) {
    renderCustomerTable(state.customers);
    return;
  }
  term = term.toLowerCase().trim();
  const filtered = state.customers.filter(c =>
    c.name.toLowerCase().includes(term) ||
    c.mobile.includes(term) ||
    (c.shop_name && c.shop_name.toLowerCase().includes(term))
  );
  renderCustomerTable(filtered);
}

function filterCustomerCategory(cat, btn) {
  document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
  btn.classList.add('active');

  if (cat === 'All') {
    renderCustomerTable(state.customers);
  } else {
    const filtered = state.customers.filter(c => c.category === cat);
    renderCustomerTable(filtered);
  }
}

async function viewCustomerDetail(customerId) {
  try {
    const res = await authFetch(`/api/customers/${customerId}`);
    if (!res.ok) return;
    const c = await res.json();
    state.selectedCustomer = c;

    document.getElementById('cust-profile-avatar').textContent = c.name.charAt(0).toUpperCase();
    document.getElementById('cust-profile-name').textContent = c.name;
    document.getElementById('cust-profile-id').textContent = c.id;
    document.getElementById('cust-profile-mobile').textContent = `Mobile: ${c.mobile}`;
    document.getElementById('cust-profile-cat').textContent = c.category;

    document.getElementById('cust-stat-purchased').textContent = `₹${c.total_purchased.toLocaleString('en-IN')}`;
    document.getElementById('cust-stat-weight').textContent = `${c.total_weight} kg`;
    document.getElementById('cust-stat-paid').textContent = `₹${c.total_paid.toLocaleString('en-IN')}`;
    document.getElementById('cust-stat-outstanding').textContent = `₹${c.outstanding.toLocaleString('en-IN')}`;

    // Render purchase history
    const tbody = document.getElementById('cust-invoices-tbody');
    tbody.innerHTML = (c.invoices || []).map(inv => `
      <tr onclick="viewInvoiceById('${inv.id}')" style="cursor: pointer;">
        <td>${inv.created_at.slice(0, 10)}</td>
        <td><span class="badge-code">${inv.invoice_no}</span></td>
        <td>Flowers (${inv.payment_status})</td>
        <td>${inv.items ? inv.items.reduce((s, i) => s + i.weight, 0) + ' kg' : '—'}</td>
        <td><strong>₹${inv.total_amount.toLocaleString('en-IN')}</strong></td>
        <td><span class="badge-cat ${inv.payment_method.replace(/\s+/g, '')}">${inv.payment_method}</span></td>
      </tr>
    `).join('') || `<tr><td colspan="6" style="text-align: center; color: #94A3B8;">No purchase records found</td></tr>`;

    // Render frequent flowers
    const freqGrid = document.getElementById('cust-frequent-grid');
    freqGrid.innerHTML = (c.frequentFlowers || []).map(f => `
      <div class="freq-flower-card">
        <div class="freq-flower-name">${f.flower_name}</div>
        <div style="font-size: 0.85rem; color: #64748B;">Total: <strong>${f.total_kg} kg</strong></div>
        <div style="font-size: 0.85rem; color: #15803D;">Spend: <strong>₹${f.total_spent.toLocaleString('en-IN')}</strong></div>
      </div>
    `).join('') || `<p style="color: #94A3B8;">No frequent purchases yet</p>`;

  } catch (err) {
    console.error(err);
  }
}

function switchCustomerTab(tab, btn) {
  document.querySelectorAll('.profile-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');

  if (tab === 'history') {
    document.getElementById('cust-tab-history').classList.remove('hidden');
    document.getElementById('cust-tab-frequent').classList.add('hidden');
  } else {
    document.getElementById('cust-tab-history').classList.add('hidden');
    document.getElementById('cust-tab-frequent').classList.remove('hidden');
  }
}

function startBillForCustomer(customerId) {
  const targetId = customerId || (state.selectedCustomer ? state.selectedCustomer.id : null);
  navigateTo('new-bill');
  if (targetId) {
    selectBillingCustomer(targetId);
  }
}

// Settle customer credit modal
function openSettleCreditModal() {
  if (!state.selectedCustomer) {
    showToast('Select a customer first', 'warn');
    return;
  }
  const c = state.selectedCustomer;
  document.getElementById('settle-customer-title').textContent = `Customer: ${c.name} (${c.id})`;
  document.getElementById('settle-outstanding-amt').textContent = `₹${c.outstanding.toLocaleString('en-IN')}`;
  document.getElementById('settle-amount').value = c.outstanding;
  document.getElementById('settle-credit-modal').classList.remove('hidden');
}

function closeSettleCreditModal() {
  document.getElementById('settle-credit-modal').classList.add('hidden');
}

async function handleSettleCredit(e) {
  e.preventDefault();
  if (!state.selectedCustomer) return;

  const amount = parseFloat(document.getElementById('settle-amount').value);
  const payment_method = document.getElementById('settle-method').value;
  const notes = document.getElementById('settle-notes').value;

  try {
    const res = await authFetch(`/api/customers/${state.selectedCustomer.id}/payment`, {
      method: 'POST',
      body: JSON.stringify({ amount, payment_method, notes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Payment of ₹${amount} recorded! Receipt: ${data.receiptNo}`, 'success');
    closeSettleCreditModal();

    // Refresh customer profile & list
    await fetchCustomers();
    viewCustomerDetail(state.selectedCustomer.id);
    fetchDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// New customer modal
function openNewCustomerModal(initialName = '') {
  document.getElementById('new-customer-form').reset();
  if (initialName) document.getElementById('new-cust-name').value = initialName;
  document.getElementById('new-customer-modal').classList.remove('hidden');
}

function closeNewCustomerModal() {
  document.getElementById('new-customer-modal').classList.add('hidden');
}

async function handleCreateCustomer(e) {
  e.preventDefault();
  const name = document.getElementById('new-cust-name').value.trim();
  const mobile = document.getElementById('new-cust-mobile').value.trim();
  const category = document.getElementById('new-cust-cat').value;
  const shop_name = document.getElementById('new-cust-shop').value.trim();
  const address = document.getElementById('new-cust-address').value.trim();

  try {
    const res = await authFetch('/api/customers', {
      method: 'POST',
      body: JSON.stringify({ name, mobile, category, shop_name, address })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Customer ${data.name} (${data.id}) created!`, 'success');
    closeNewCustomerModal();
    await fetchCustomers();

    // If on billing page, auto-select this new customer!
    if (state.currentView === 'new-bill') {
      selectBillingCustomer(data.id);
    } else {
      viewCustomerDetail(data.id);
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =========================================================
// 5. FLOWER INVENTORY MANAGEMENT
// =========================================================
async function fetchFlowers() {
  try {
    const res = await authFetch('/api/flowers');
    if (!res.ok) return;
    state.flowers = await res.json();
    renderInventoryTable(state.flowers);

    // Check minimum stock alerts
    const lowStock = state.flowers.filter(f => f.available_stock <= f.min_stock);
    const alertBadge = document.getElementById('sidebar-stock-alert');
    if (lowStock.length > 0) {
      alertBadge.textContent = lowStock.length;
      alertBadge.classList.remove('hidden');
    } else {
      alertBadge.classList.add('hidden');
    }
  } catch (err) {
    console.error(err);
  }
}

function renderInventoryTable(flowers) {
  const tbody = document.getElementById('inventory-tbody');
  if (!tbody) return;

  tbody.innerHTML = flowers.map(f => {
    const isLow = f.available_stock <= f.min_stock;
    return `
      <tr>
        <td><strong>${f.name}</strong></td>
        <td>${f.variety}</td>
        <td><strong style="font-size: 1.05rem; ${isLow ? 'color: #DC2626;' : 'color: #15803D;'}">${f.available_stock}</strong></td>
        <td>${f.unit || 'kg'}</td>
        <td>${f.min_stock} kg</td>
        <td><strong>₹${f.selling_rate}</strong> / kg</td>
        <td style="color: #64748B;">₹${f.purchase_cost} / kg</td>
        <td>
          <span class="badge-status ${isLow ? 'low' : 'ok'}">
            ${isLow ? '⚠️ Low Stock' : '✓ OK'}
          </span>
        </td>
        <td>
          <div style="display: flex; gap: 6px;">
            <button class="btn btn-outline btn-xs" onclick="openAddStockModal(${f.id})">+ Stock</button>
            <button class="btn btn-outline btn-xs" onclick="openWastageModal(${f.id})">🥀 Waste</button>
          </div>
        </td>
      </tr>
    `;
  }).join('');
}

async function fetchStockMovements() {
  try {
    const res = await authFetch('/api/inventory/movements');
    if (!res.ok) return;
    const movements = await res.json();
    const tbody = document.getElementById('movements-tbody');
    if (!tbody) return;

    tbody.innerHTML = movements.map(m => `
      <tr>
        <td>${m.created_at}</td>
        <td><strong>${m.flower_name}</strong></td>
        <td>${m.variety}</td>
        <td>
          <span class="badge-cat ${m.type}">
            ${m.type === 'Purchase' ? '📥 Purchase' : m.type === 'Sale' ? '🧾 Sale' : m.type === 'Wastage' ? '🥀 Wastage' : '⚙️ Adjust'}
          </span>
        </td>
        <td>
          <strong style="${m.weight > 0 ? 'color: #15803D;' : 'color: #E11D48;'}">
            ${m.weight > 0 ? `+${m.weight}` : m.weight} kg
          </strong>
        </td>
        <td>${m.rate ? `₹${m.rate}` : '—'}</td>
        <td>${m.supplier || m.reason || '—'}</td>
        <td>${m.recorded_by}</td>
      </tr>
    `).join('') || `<tr><td colspan="8" style="text-align: center; color: #94A3B8;">No movements logged</td></tr>`;
  } catch (err) {
    console.error(err);
  }
}

// Add stock modal
function openAddStockModal(flowerId = null) {
  const select = document.getElementById('stock-flower-id');
  select.innerHTML = state.flowers.map(f => `
    <option value="${f.id}" data-cost="${f.purchase_cost}" ${f.id === flowerId ? 'selected' : ''}>
      ${f.name} (${f.variety}) - Current: ${f.available_stock}kg
    </option>
  `).join('');

  if (flowerId) onStockFlowerSelect(flowerId);
  document.getElementById('add-stock-modal').classList.remove('hidden');
}

function closeAddStockModal() {
  document.getElementById('add-stock-modal').classList.add('hidden');
}

function onStockFlowerSelect(flowerId) {
  const f = state.flowers.find(item => item.id === parseInt(flowerId, 10));
  if (f) {
    document.getElementById('stock-rate').value = f.purchase_cost;
  }
}

async function handleAddStock(e) {
  e.preventDefault();
  const flower_id = parseInt(document.getElementById('stock-flower-id').value, 10);
  const weight = parseFloat(document.getElementById('stock-weight').value);
  const rate = parseFloat(document.getElementById('stock-rate').value);
  const supplier = document.getElementById('stock-supplier').value.trim();
  const notes = document.getElementById('stock-notes').value.trim();

  try {
    const res = await authFetch('/api/inventory/purchase', {
      method: 'POST',
      body: JSON.stringify({ flower_id, weight, rate, supplier, notes })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message, 'success');
    closeAddStockModal();
    fetchFlowers();
    fetchStockMovements();
    fetchDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Record wastage modal
function openWastageModal(flowerId = null) {
  const select = document.getElementById('waste-flower-id');
  select.innerHTML = state.flowers.map(f => `
    <option value="${f.id}" ${f.id === flowerId ? 'selected' : ''}>
      ${f.name} (${f.variety}) - Avail: ${f.available_stock}kg
    </option>
  `).join('');
  document.getElementById('wastage-modal').classList.remove('hidden');
}

function closeWastageModal() {
  document.getElementById('wastage-modal').classList.add('hidden');
}

async function handleRecordWastage(e) {
  e.preventDefault();
  const flower_id = parseInt(document.getElementById('waste-flower-id').value, 10);
  const weight = parseFloat(document.getElementById('waste-weight').value);
  const reason = document.getElementById('waste-reason').value;

  try {
    const res = await authFetch('/api/inventory/wastage', {
      method: 'POST',
      body: JSON.stringify({ flower_id, weight, reason })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(data.message, 'info');
    closeWastageModal();
    fetchFlowers();
    fetchStockMovements();
    fetchDashboardData();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// Create new flower variety modal
function openNewFlowerModal() {
  document.getElementById('new-flower-modal').classList.remove('hidden');
}

function closeNewFlowerModal() {
  document.getElementById('new-flower-modal').classList.add('hidden');
}

async function handleCreateFlower(e) {
  e.preventDefault();
  const name = document.getElementById('new-flower-name').value.trim();
  const variety = document.getElementById('new-flower-variety').value.trim();
  const available_stock = parseFloat(document.getElementById('new-flower-stock').value) || 0;
  const min_stock = parseFloat(document.getElementById('new-flower-min').value) || 5;
  const unit = document.getElementById('new-flower-unit').value;
  const selling_rate = parseFloat(document.getElementById('new-flower-sell').value);
  const purchase_cost = parseFloat(document.getElementById('new-flower-cost').value);

  try {
    const res = await authFetch('/api/flowers', {
      method: 'POST',
      body: JSON.stringify({ name, variety, available_stock, min_stock, unit, selling_rate, purchase_cost })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Added ${name} (${variety}) to catalog!`, 'success');
    closeNewFlowerModal();
    fetchFlowers();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =========================================================
// 6. PAYMENTS & CREDIT
// =========================================================
async function fetchPayments() {
  try {
    const res = await authFetch('/api/payments');
    if (!res.ok) return;
    const payments = await res.json();
    const tbody = document.getElementById('payments-tbody');
    if (!tbody) return;

    tbody.innerHTML = payments.map(p => `
      <tr>
        <td><span class="badge-code">${p.receipt_no}</span></td>
        <td><strong>${p.customer_name}</strong></td>
        <td>${p.invoice_no || 'Direct Settlement'}</td>
        <td><strong style="color: #15803D;">₹${p.amount.toLocaleString('en-IN')}</strong></td>
        <td><span class="badge-cat ${p.payment_method.replace(/\s+/g, '')}">${p.payment_method}</span></td>
        <td>${p.created_at}</td>
        <td>${p.notes || '—'}</td>
        <td>${p.recorded_by}</td>
      </tr>
    `).join('') || `<tr><td colspan="8" style="text-align: center; color: #94A3B8;">No payment records</td></tr>`;
  } catch (err) {
    console.error(err);
  }
}

// =========================================================
// 7. REPORTS & ANALYTICS
// =========================================================
async function fetchReportsSummary() {
  try {
    const res = await authFetch('/api/reports/summary');
    if (!res.ok) return;
    const rep = await res.json();

    document.getElementById('report-sales').textContent = `₹${rep.totalSales.toLocaleString('en-IN')}`;
    document.getElementById('report-orders').textContent = rep.totalOrders;
    document.getElementById('report-cash').textContent = `₹${rep.cashCollection.toLocaleString('en-IN')}`;
    document.getElementById('report-upi').textContent = `₹${rep.upiCollection.toLocaleString('en-IN')}`;
    document.getElementById('report-profit').textContent = `₹${rep.estimatedGrossProfit.toLocaleString('en-IN')}`;

    // Render Sales Trend Chart
    renderSalesTrendChart();

    // Render Flower Distribution Donut
    renderFlowerDistributionChart(rep.flowerBreakdown);

    // Render Performance table
    const tbody = document.getElementById('report-flowers-tbody');
    tbody.innerHTML = rep.flowerBreakdown.map(f => {
      const avgRate = f.total_weight ? Math.round(f.total_sales / f.total_weight) : 0;
      const estCogs = Math.round(f.total_sales * 0.72);
      const estMargin = Math.round(f.total_sales - estCogs);
      return `
        <tr>
          <td><strong>${f.flower_name}</strong></td>
          <td>${f.total_weight} kg</td>
          <td><strong>₹${f.total_sales.toLocaleString('en-IN')}</strong></td>
          <td>₹${avgRate} / kg</td>
          <td>₹${estCogs.toLocaleString('en-IN')}</td>
          <td><strong style="color: #15803D;">₹${estMargin.toLocaleString('en-IN')}</strong></td>
        </tr>
      `;
    }).join('');

  } catch (err) {
    console.error(err);
  }
}

function renderSalesTrendChart() {
  const ctx = document.getElementById('salesTrendChart');
  if (!ctx) return;

  if (state.salesTrendChart) state.salesTrendChart.destroy();

  const labels = ['10 Oct', '11 Oct', '12 Oct', '13 Oct', '14 Oct', '15 Oct', '16 Oct'];
  const values = [18200, 21400, 19800, 26500, 23900, 29800, 34200];

  state.salesTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels,
      datasets: [{
        label: 'Sales Trend (₹)',
        data: values,
        borderColor: '#15803D',
        backgroundColor: 'rgba(21, 128, 61, 0.08)',
        fill: true,
        tension: 0.35,
        pointBackgroundColor: '#15803D',
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: {
          beginAtZero: false,
          ticks: { callback: v => `₹${v / 1000}k` }
        }
      }
    }
  });
}

function renderFlowerDistributionChart(flowerData) {
  const ctx = document.getElementById('flowerDistributionChart');
  if (!ctx) return;

  if (state.flowerDistributionChart) state.flowerDistributionChart.destroy();

  const labels = flowerData.map(f => f.flower_name);
  const dataVals = flowerData.map(f => f.total_sales);
  const colors = ['#E05375', '#E11D48', '#D97706', '#059669', '#3B82F6', '#8B5CF6'];

  state.flowerDistributionChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: labels,
      datasets: [{
        data: dataVals,
        backgroundColor: colors
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'right' }
      }
    }
  });
}

// Export Reports to Excel / CSV / PDF
function exportReport(format) {
  if (format === 'pdf') {
    window.print();
    return;
  }
  // Generate CSV data from current customers & flower sales
  let csv = 'Flower Name,Total Weight Sold (kg),Total Revenue (INR)\n';
  const rows = document.querySelectorAll('#report-flowers-tbody tr');
  rows.forEach(tr => {
    const cols = Array.from(tr.querySelectorAll('td')).map(td => `"${td.textContent.trim().replace(/₹|,/g, '')}"`);
    if (cols.length >= 3) {
      csv += `${cols[0]},${cols[1]},${cols[2]}\n`;
    }
  });

  const blob = new Blob([csv], { type: format === 'excel' ? 'application/vnd.ms-excel' : 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `fresh_blooms_report_${Date.now()}.${format === 'excel' ? 'xls' : 'csv'}`;
  a.click();
  showToast(`Report exported as ${format.toUpperCase()}`, 'success');
}

// =========================================================
// 8. STAFF & ROLES
// =========================================================
async function fetchStaffList() {
  try {
    const res = await authFetch('/api/users');
    if (!res.ok) return;
    const users = await res.json();
    const tbody = document.getElementById('staff-tbody');
    if (!tbody) return;

    tbody.innerHTML = users.map(u => `
      <tr>
        <td>#${u.id}</td>
        <td><strong>${u.name}</strong></td>
        <td>${u.username}</td>
        <td>${u.mobile || '—'}</td>
        <td><span class="badge-cat ${u.role}">${u.role.replace('_', ' ')}</span></td>
        <td><code>${u.pin || '****'}</code></td>
        <td>
          <span class="badge-status ${u.active ? 'ok' : 'low'}">
            ${u.active ? 'Active' : 'Inactive'}
          </span>
        </td>
        <td>
          <button class="btn btn-outline btn-xs" onclick="toggleStaffActive(${u.id}, ${u.active ? 0 : 1})">
            ${u.active ? 'Deactivate' : 'Activate'}
          </button>
        </td>
      </tr>
    `).join('');
  } catch (err) {
    console.error(err);
  }
}

async function toggleStaffActive(userId, newActiveState) {
  try {
    const res = await authFetch(`/api/users/${userId}`, {
      method: 'PUT',
      body: JSON.stringify({ active: newActiveState })
    });
    if (!res.ok) throw new Error('Failed to update status');
    showToast('Staff status updated', 'success');
    fetchStaffList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function openNewStaffModal() {
  document.getElementById('new-staff-modal').classList.remove('hidden');
}

function closeNewStaffModal() {
  document.getElementById('new-staff-modal').classList.add('hidden');
}

async function handleCreateStaff(e) {
  e.preventDefault();
  const name = document.getElementById('staff-name').value.trim();
  const username = document.getElementById('staff-username').value.trim();
  const mobile = document.getElementById('staff-mobile').value.trim();
  const role = document.getElementById('staff-role').value;
  const pin = document.getElementById('staff-pin').value.trim();
  const password = document.getElementById('staff-password').value;

  try {
    const res = await authFetch('/api/users', {
      method: 'POST',
      body: JSON.stringify({ name, username, mobile, role, pin, password })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    showToast(`Staff account for ${name} created!`, 'success');
    closeNewStaffModal();
    fetchStaffList();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

// =========================================================
// 9. SETTINGS & AUDIT LOGS
// =========================================================
async function fetchSettings() {
  try {
    const res = await authFetch('/api/settings');
    if (!res.ok) return;
    const s = await res.json();

    if (s.shop_name) document.getElementById('setting-shop-name').value = s.shop_name;
    if (s.tagline) document.getElementById('setting-tagline').value = s.tagline;
    if (s.address) document.getElementById('setting-address').value = s.address;
    if (s.phone) document.getElementById('setting-phone').value = s.phone;
    if (s.gstin) document.getElementById('setting-gstin').value = s.gstin;
    if (s.invoice_prefix) document.getElementById('setting-prefix').value = s.invoice_prefix;
    if (s.currency) document.getElementById('setting-currency').value = s.currency;
    if (s.footer_note) document.getElementById('setting-footer').value = s.footer_note;
  } catch (e) {
    console.error(e);
  }
}

async function handleSaveSettings(e) {
  e.preventDefault();
  const payload = {
    shop_name: document.getElementById('setting-shop-name').value,
    tagline: document.getElementById('setting-tagline').value,
    address: document.getElementById('setting-address').value,
    phone: document.getElementById('setting-phone').value,
    gstin: document.getElementById('setting-gstin').value,
    invoice_prefix: document.getElementById('setting-prefix').value,
    currency: document.getElementById('setting-currency').value,
    footer_note: document.getElementById('setting-footer').value
  };

  try {
    const res = await authFetch('/api/settings', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error('Failed to update settings');
    showToast('Store settings saved successfully!', 'success');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function fetchAuditLogs() {
  try {
    const res = await authFetch('/api/audit-logs');
    if (!res.ok) return;
    const logs = await res.json();
    const tbody = document.getElementById('audit-tbody');
    if (!tbody) return;

    tbody.innerHTML = logs.map(l => `
      <tr>
        <td style="font-family: monospace; font-size: 0.8rem;">${l.created_at}</td>
        <td><strong>${l.user_name}</strong></td>
        <td><span class="badge-cat ${l.user_role}">${l.user_role}</span></td>
        <td><strong style="color: #15803D;">${l.action}</strong></td>
        <td>${l.details}</td>
      </tr>
    `).join('') || `<tr><td colspan="5" style="text-align: center; color: #94A3B8;">No audit logs</td></tr>`;
  } catch (err) {
    console.error(err);
  }
}

// =========================================================
// HELPER UTILITIES
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
