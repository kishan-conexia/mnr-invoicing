const token = localStorage.getItem('mnr_token');
const user = JSON.parse(localStorage.getItem('mnr_user') || 'null');
if (!token || !user) window.location.href = '/login.html';

document.getElementById('whoAmI').textContent = `${user.name} (${user.role})`;
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('mnr_token');
  localStorage.removeItem('mnr_user');
  window.location.href = '/login.html';
});

const GST_STATES = [
  ['01', 'Jammu and Kashmir'], ['02', 'Himachal Pradesh'], ['03', 'Punjab'], ['04', 'Chandigarh'],
  ['05', 'Uttarakhand'], ['06', 'Haryana'], ['07', 'Delhi'], ['08', 'Rajasthan'], ['09', 'Uttar Pradesh'],
  ['10', 'Bihar'], ['11', 'Sikkim'], ['12', 'Arunachal Pradesh'], ['13', 'Nagaland'], ['14', 'Manipur'],
  ['15', 'Mizoram'], ['16', 'Tripura'], ['17', 'Meghalaya'], ['18', 'Assam'], ['19', 'West Bengal'],
  ['20', 'Jharkhand'], ['21', 'Odisha'], ['22', 'Chhattisgarh'], ['23', 'Madhya Pradesh'], ['24', 'Gujarat'],
  ['26', 'Dadra and Nagar Haveli and Daman and Diu'], ['27', 'Maharashtra'], ['28', 'Andhra Pradesh (Old)'],
  ['29', 'Karnataka'], ['30', 'Goa'], ['31', 'Lakshadweep'], ['32', 'Kerala'], ['33', 'Tamil Nadu'],
  ['34', 'Puducherry'], ['35', 'Andaman and Nicobar Islands'], ['36', 'Telangana'], ['37', 'Andhra Pradesh'],
  ['38', 'Ladakh'],
];

let customers = [];
let products = [];
let taxRates = [];
let company = null;

function todayStr() { return new Date().toISOString().slice(0, 10); }
function plusDays(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }
document.getElementById('f_invoiceDate').value = todayStr();
document.getElementById('f_dueDate').value = plusDays(15);

async function authedFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (res.status === 401) { window.location.href = '/login.html'; throw new Error('logged out'); }
  return res;
}

// ── Generic searchable combo box ────────────────────────
// One reusable pattern used for both the customer field and every line item's
// service field: a text input filters a list; picking an item fires onSelect;
// typing something with no match shows an "+ Add new" row that fires onAddNew.
function wireCombo({ searchInput, hiddenInput, dropdown, getItems, renderOption, matchText, onSelect, addNewLabel, onAddNew }) {
  let highlighted = -1;

  function render(query) {
    const items = getItems().filter((item) => matchText(item).toLowerCase().includes(query.toLowerCase()));
    let html = items.slice(0, 8).map((item, i) => `<div class="combo-option" data-index="${i}">${renderOption(item)}</div>`).join('');
    if (items.length === 0) html += `<div class="combo-empty">No matches</div>`;
    if (query.trim()) html += `<div class="combo-option addNew" data-addnew="1">+ Add "${query.trim()}" as ${addNewLabel}</div>`;
    dropdown.innerHTML = html;
    dropdown.classList.toggle('open', true);
    highlighted = -1;

    dropdown.querySelectorAll('.combo-option[data-index]').forEach((el) => {
      el.addEventListener('mousedown', (e) => {
        e.preventDefault();
        const item = items[Number(el.dataset.index)];
        selectItem(item);
      });
    });
    const addNewEl = dropdown.querySelector('.combo-option[data-addnew]');
    if (addNewEl) {
      addNewEl.addEventListener('mousedown', (e) => {
        e.preventDefault();
        dropdown.classList.remove('open');
        onAddNew(query.trim());
      });
    }
  }

  function selectItem(item) {
    onSelect(item);
    dropdown.classList.remove('open');
  }

  searchInput.addEventListener('focus', () => render(searchInput.value));
  searchInput.addEventListener('input', () => { hiddenInput.value = ''; render(searchInput.value); });
  searchInput.addEventListener('blur', () => setTimeout(() => dropdown.classList.remove('open'), 150));
  searchInput.addEventListener('keydown', (e) => {
    const options = [...dropdown.querySelectorAll('.combo-option')];
    if (e.key === 'ArrowDown') { e.preventDefault(); highlighted = Math.min(highlighted + 1, options.length - 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); highlighted = Math.max(highlighted - 1, 0); }
    else if (e.key === 'Enter') { e.preventDefault(); options[highlighted]?.dispatchEvent(new Event('mousedown')); return; }
    else return;
    options.forEach((o, i) => o.classList.toggle('highlighted', i === highlighted));
  });

  return { render, selectItem };
}

// ── Customer combo ───────────────────────────────────────
function customerDisplayName(c) {
  return c.displayName || c.companyName || c.name;
}

const customerCombo = wireCombo({
  searchInput: document.getElementById('f_customerSearch'),
  hiddenInput: document.getElementById('f_customer'),
  dropdown: document.getElementById('customerDropdown'),
  getItems: () => customers,
  renderOption: (c) => `${customerDisplayName(c)}${c.name !== customerDisplayName(c) ? '<div class="sub">' + c.name + '</div>' : ''}`,
  matchText: (c) => `${customerDisplayName(c)} ${c.name} ${c.companyName || ''}`,
  addNewLabel: 'a new customer',
  onSelect: (c) => {
    document.getElementById('f_customer').value = c.id;
    document.getElementById('f_customerSearch').value = customerDisplayName(c);
    updateTaxTypeNote();
  },
  onAddNew: (query) => openQuickAddCustomer(query),
});

function updateTaxTypeNote() {
  const customer = customers.find((c) => c.id === document.getElementById('f_customer').value);
  const note = document.getElementById('taxTypeNote');
  if (!customer || !company?.gstin) { note.textContent = ''; return; }
  const companyStateCode = company.gstin.slice(0, 2);
  note.textContent = customer.stateCode === companyStateCode
    ? `Same state as MNR (${customer.state}) — CGST + SGST will apply`
    : `Different state from MNR (${customer.state || 'unknown'}) — IGST will apply`;
  recalculate();
}

// ── Quick-add customer modal ─────────────────────────────
const qcModal = document.getElementById('quickAddCustomerModal');
const qcStateSelect = document.getElementById('qc_state');
qcStateSelect.innerHTML = GST_STATES.map(([code, name]) => `<option value="${code}">${name} (${code})</option>`).join('');
qcStateSelect.value = '27';

function nextCustomerCode() {
  const nums = customers.map((c) => parseInt((c.customerCode || '').replace(/\D/g, ''), 10)).filter((n) => !isNaN(n));
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `CUST-${String(next).padStart(4, '0')}`;
}

// Same "pick from Name or Company Name, no free text" rule as the main Customers page.
const qcNameInput = document.getElementById('qc_name');
const qcCompanyInput = document.getElementById('qc_company');
const qcDisplayNameSelect = document.getElementById('qc_displayName');

function refreshQcDisplayNameOptions() {
  const previousChoice = qcDisplayNameSelect.value;
  const nameVal = qcNameInput.value.trim();
  const companyVal = qcCompanyInput.value.trim();
  const options = [];
  if (nameVal) options.push({ value: 'name', label: nameVal });
  if (companyVal) options.push({ value: 'company', label: companyVal });
  qcDisplayNameSelect.innerHTML = options.length
    ? options.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')
    : '<option value="">— Enter a name first —</option>';
  if (options.some((o) => o.value === previousChoice)) qcDisplayNameSelect.value = previousChoice;
  else if (companyVal) qcDisplayNameSelect.value = 'company';
  else if (nameVal) qcDisplayNameSelect.value = 'name';
}
qcNameInput.addEventListener('input', refreshQcDisplayNameOptions);
qcCompanyInput.addEventListener('input', refreshQcDisplayNameOptions);
function qcCurrentDisplayNameValue() {
  return qcDisplayNameSelect.value === 'company' ? qcCompanyInput.value.trim() : qcNameInput.value.trim();
}

function openQuickAddCustomer(prefillName) {
  document.getElementById('qc_code').value = nextCustomerCode();
  qcNameInput.value = prefillName || '';
  qcCompanyInput.value = '';
  refreshQcDisplayNameOptions();
  document.getElementById('qc_gstin').value = '';
  document.getElementById('qc_error').style.display = 'none';
  qcModal.style.display = 'flex';
  qcNameInput.focus();
}
document.getElementById('qc_cancel').addEventListener('click', () => { qcModal.style.display = 'none'; });
document.getElementById('qc_gstin').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
});
document.getElementById('qc_save').addEventListener('click', async () => {
  const errorBox = document.getElementById('qc_error');
  errorBox.style.display = 'none';

  const stateCode = qcStateSelect.value;
  const stateName = GST_STATES.find(([code]) => code === stateCode)?.[1];
  const body = {
    customerCode: document.getElementById('qc_code').value,
    displayName: qcCurrentDisplayNameValue(),
    name: qcNameInput.value,
    companyName: qcCompanyInput.value || undefined,
    gstin: document.getElementById('qc_gstin').value || undefined,
    state: stateName,
    stateCode,
  };
  if (!body.customerCode || !body.name || !body.displayName) {
    errorBox.textContent = 'Customer code, name, and display name are required.';
    errorBox.style.display = 'block';
    return;
  }

  const res = await authedFetch('/api/customers', { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { errorBox.textContent = data.error || 'Could not add customer'; errorBox.style.display = 'block'; return; }

  customers.push(data);
  customerCombo.selectItem(data);
  qcModal.style.display = 'none';
});

// ── Line items ────────────────────────────────────────────
function addLine() {
  const tbody = document.getElementById('itemsBody');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td>
      <div class="combo">
        <input type="text" class="line-product-search" placeholder="Search service…" autocomplete="off">
        <input type="hidden" class="line-product-id">
        <div class="combo-dropdown line-product-dropdown"></div>
      </div>
    </td>
    <td><input class="line-qty" type="number" value="1" min="0" step="0.01"></td>
    <td><input class="line-rate" type="number" value="0" min="0" step="0.01"></td>
    <td><input class="line-discount" type="number" value="0" min="0" max="100" step="0.01"></td>
    <td><input class="line-tax" type="number" value="18" min="0" max="100" step="0.01"></td>
    <td class="num line-total">₹0.00</td>
    <td><button class="removeBtn" title="Remove line">✕</button></td>
  `;
  tbody.appendChild(row);

  wireCombo({
    searchInput: row.querySelector('.line-product-search'),
    hiddenInput: row.querySelector('.line-product-id'),
    dropdown: row.querySelector('.line-product-dropdown'),
    getItems: () => products,
    renderOption: (p) => `${p.name}<div class="sub">₹${Number(p.standardRate).toFixed(2)} · ${p.taxRate ? p.taxRate.name : 'No tax'}</div>`,
    matchText: (p) => `${p.name} ${p.code}`,
    addNewLabel: 'a new service',
    onSelect: (p) => {
      row.querySelector('.line-product-id').value = p.id;
      row.querySelector('.line-product-search').value = p.name;
      row.querySelector('.line-rate').value = p.standardRate;
      row.querySelector('.line-tax').value = p.taxRate ? p.taxRate.ratePct : 0;
      recalculate();
    },
    onAddNew: (query) => openQuickAddService(query, row),
  });

  row.querySelectorAll('.line-qty, .line-rate, .line-discount, .line-tax').forEach((el) => el.addEventListener('input', recalculate));
  row.querySelector('.removeBtn').addEventListener('click', () => { row.remove(); recalculate(); });

  recalculate();
}
document.getElementById('addLineBtn').addEventListener('click', addLine);

// ── Quick-add service modal ───────────────────────────────
const qsModal = document.getElementById('quickAddServiceModal');
let quickAddServiceTargetRow = null;

function nextServiceCode() {
  return `SVC-NEW-${String(products.length + 1).padStart(3, '0')}`;
}

function openQuickAddService(prefillName, targetRow) {
  quickAddServiceTargetRow = targetRow;
  document.getElementById('qs_code').value = nextServiceCode();
  document.getElementById('qs_name').value = prefillName || '';
  document.getElementById('qs_rate').value = '';
  document.getElementById('qs_error').style.display = 'none';
  qsModal.style.display = 'flex';
  document.getElementById('qs_name').focus();
}
document.getElementById('qs_cancel').addEventListener('click', () => { qsModal.style.display = 'none'; });
document.getElementById('qs_save').addEventListener('click', async () => {
  const errorBox = document.getElementById('qs_error');
  errorBox.style.display = 'none';

  const body = {
    code: document.getElementById('qs_code').value,
    name: document.getElementById('qs_name').value,
    standardRate: document.getElementById('qs_rate').value,
    taxRateId: document.getElementById('qs_tax').value || undefined,
  };
  if (!body.code || !body.name || body.standardRate === '') {
    errorBox.textContent = 'Code, name, and rate are required.';
    errorBox.style.display = 'block';
    return;
  }

  const res = await authedFetch('/api/products', { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { errorBox.textContent = data.error || 'Could not add service'; errorBox.style.display = 'block'; return; }

  products.push(data);
  if (quickAddServiceTargetRow) {
    quickAddServiceTargetRow.querySelector('.line-product-id').value = data.id;
    quickAddServiceTargetRow.querySelector('.line-product-search').value = data.name;
    quickAddServiceTargetRow.querySelector('.line-rate').value = data.standardRate;
    quickAddServiceTargetRow.querySelector('.line-tax').value = data.taxRate ? data.taxRate.ratePct : 0;
    recalculate();
  }
  qsModal.style.display = 'none';
});

// ── GST calculation ────────────────────────────────────────
function formatRupees(n) { return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function isIntraState() {
  const customer = customers.find((c) => c.id === document.getElementById('f_customer').value);
  if (!customer || !company?.gstin) return true;
  return customer.stateCode === company.gstin.slice(0, 2);
}

function recalculate() {
  const rows = [...document.querySelectorAll('#itemsBody tr')];
  const intra = isIntraState();
  let subtotal = 0, taxable = 0, cgst = 0, sgst = 0, igst = 0;

  rows.forEach((row) => {
    const qty = Number(row.querySelector('.line-qty').value) || 0;
    const rate = Number(row.querySelector('.line-rate').value) || 0;
    const discountPct = Number(row.querySelector('.line-discount').value) || 0;
    const taxPct = Number(row.querySelector('.line-tax').value) || 0;

    const gross = qty * rate;
    const taxableValue = gross - (gross * discountPct) / 100;
    const taxAmount = (taxableValue * taxPct) / 100;
    row.querySelector('.line-total').textContent = formatRupees(taxableValue + taxAmount);

    subtotal += gross;
    taxable += taxableValue;
    if (intra) { cgst += taxAmount / 2; sgst += taxAmount / 2; } else { igst += taxAmount; }
  });

  document.getElementById('s_subtotal').textContent = formatRupees(subtotal);
  document.getElementById('s_taxable').textContent = formatRupees(taxable);
  document.getElementById('s_cgst').textContent = formatRupees(cgst);
  document.getElementById('s_sgst').textContent = formatRupees(sgst);
  document.getElementById('s_igst').textContent = formatRupees(igst);
  document.getElementById('s_cgstRow').style.display = intra ? 'flex' : 'none';
  document.getElementById('s_sgstRow').style.display = intra ? 'flex' : 'none';
  document.getElementById('s_igstRow').style.display = intra ? 'none' : 'flex';
  document.getElementById('s_total').textContent = formatRupees(Math.round(taxable + cgst + sgst + igst));
}

// ── Submit ──────────────────────────────────────────────
document.getElementById('saveBtn').addEventListener('click', async () => {
  const errorBox = document.getElementById('errorBox');
  errorBox.style.display = 'none';

  const rows = [...document.querySelectorAll('#itemsBody tr')];
  const items = rows.map((row) => ({
    productServiceId: row.querySelector('.line-product-id').value || undefined,
    description: row.querySelector('.line-product-search').value || 'Custom line item',
    quantity: row.querySelector('.line-qty').value,
    rate: row.querySelector('.line-rate').value,
    discountPct: row.querySelector('.line-discount').value,
    taxRatePct: row.querySelector('.line-tax').value,
  }));

  const body = {
    customerId: document.getElementById('f_customer').value,
    invoiceDate: document.getElementById('f_invoiceDate').value,
    dueDate: document.getElementById('f_dueDate').value,
    items,
  };

  if (!body.customerId || items.length === 0) {
    errorBox.textContent = 'Pick a customer and add at least one line item.';
    errorBox.style.display = 'block';
    return;
  }

  const res = await authedFetch('/api/invoices', { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { errorBox.textContent = data.error || 'Could not save invoice'; errorBox.style.display = 'block'; return; }

  window.location.href = `/invoice-view.html?id=${data.id}`;
});

// ── Initial load ───────────────────────────────────────────
async function loadInitialData() {
  const [custRes, prodRes, companyRes, taxRes] = await Promise.all([
    authedFetch('/api/customers'),
    authedFetch('/api/products'),
    authedFetch('/api/company'),
    authedFetch('/api/tax-rates'),
  ]);
  customers = await custRes.json();
  products = await prodRes.json();
  company = await companyRes.json();
  taxRates = await taxRes.json();

  document.getElementById('qs_tax').innerHTML = taxRates.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');

  addLine();
}

loadInitialData();
