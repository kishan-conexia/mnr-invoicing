const token = localStorage.getItem('mnr_token');
const user = JSON.parse(localStorage.getItem('mnr_user') || 'null');

if (!token || !user) {
  window.location.href = '/login.html';
}

document.getElementById('whoAmI').textContent = `${user.name} (${user.role})`;

document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('mnr_token');
  localStorage.removeItem('mnr_user');
  window.location.href = '/login.html';
});

// Standard GST state/UT codes — used both for the dropdown and, on the server,
// to compare against MNR's own state code to decide CGST+SGST vs IGST.
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

const stateSelect = document.getElementById('f_state');
stateSelect.innerHTML = GST_STATES.map(([code, name]) => `<option value="${code}">${name} (${code})</option>`).join('');
stateSelect.value = '27'; // Maharashtra default, matches MNR's own registration

// ── Distribution hierarchy ──────────────────────────────
// Company (MNR itself) -> Distributor L1 -> Distributor L2 -> Partner -> Customer.
// Each tier's parent must be exactly the tier above it, mirrored here for a
// good UI experience; the server enforces this independently either way.
const TIER_LABELS = { DISTRIBUTOR_L1: 'Distributor L1', DISTRIBUTOR_L2: 'Distributor L2', PARTNER: 'Partner', CUSTOMER: 'Customer' };
const REQUIRED_PARENT_TIER = { DISTRIBUTOR_L1: null, DISTRIBUTOR_L2: 'DISTRIBUTOR_L1', PARTNER: 'DISTRIBUTOR_L2', CUSTOMER: 'PARTNER' };

const tierSelect = document.getElementById('f_tier');
const parentSelect = document.getElementById('f_parent');
const parentFieldWrap = document.getElementById('parentFieldWrap');
const parentLabel = document.getElementById('parentLabel');
const parentError = document.getElementById('parentError');

function refreshParentOptions() {
  const tier = tierSelect.value;
  const requiredParentTier = REQUIRED_PARENT_TIER[tier];
  const editingId = document.getElementById('f_id').value;

  if (requiredParentTier === null) {
    parentFieldWrap.style.display = 'none';
    parentSelect.innerHTML = '';
    return;
  }
  parentFieldWrap.style.display = 'block';
  parentLabel.textContent = `Parent (must be a ${TIER_LABELS[requiredParentTier]})`;

  const eligibleParents = customers.filter((c) => c.tier === requiredParentTier && c.id !== editingId);
  parentSelect.innerHTML = eligibleParents.length
    ? eligibleParents.map((c) => `<option value="${c.id}">${c.displayName || c.companyName || c.name}</option>`).join('')
    : '<option value="">— No eligible parent exists yet —</option>';
}
tierSelect.addEventListener('change', refreshParentOptions);

document.getElementById('sameAsBilling').addEventListener('change', (e) => {
  document.getElementById('installationFields').style.display = e.target.checked ? 'none' : 'block';
});

// ── Live field validation ──────────────────────────────
// GSTIN: exactly 15 characters — first 2 numeric (state code), remaining 13
// alphanumeric, no special characters. Pincode: exactly 6 digits.
const GSTIN_PATTERN = /^[0-9]{2}[A-Z0-9]{13}$/;
const PINCODE_PATTERN = /^[0-9]{6}$/;

function validateField(inputEl, errorEl, pattern, message) {
  const value = inputEl.value.trim();
  if (value === '') {
    inputEl.classList.remove('invalid');
    errorEl.style.display = 'none';
    return true;
  }
  const valid = pattern.test(value);
  inputEl.classList.toggle('invalid', !valid);
  errorEl.textContent = valid ? '' : message;
  errorEl.style.display = valid ? 'none' : 'block';
  return valid;
}

const gstinInput = document.getElementById('f_gstin');
const gstinError = document.getElementById('gstinError');
gstinInput.addEventListener('input', () => {
  gstinInput.value = gstinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
  const value = gstinInput.value;
  let message = '';
  if (value.length >= 1 && !/^[0-9]/.test(value)) {
    message = 'GSTIN must start with 2 digits (the state code).';
  } else if (value.length >= 2 && !/^[0-9]{2}/.test(value)) {
    message = 'GSTIN must start with 2 digits (the state code).';
  } else if (value.length === 15 && !GSTIN_PATTERN.test(value)) {
    message = 'GSTIN must be exactly 15 characters: 2 digits followed by 13 letters/numbers.';
  } else if (value.length > 0 && value.length < 15 && !/^[0-9]{2}[A-Z0-9]*$/.test(value)) {
    message = 'GSTIN must be exactly 15 characters: 2 digits followed by 13 letters/numbers.';
  }
  gstinInput.classList.toggle('invalid', message !== '');
  gstinError.textContent = message;
  gstinError.style.display = message ? 'block' : 'none';

  // Auto-select the matching state once the first two digits form a real GST state code
  if (/^[0-9]{2}/.test(value)) {
    const prefix = value.slice(0, 2);
    const match = GST_STATES.find(([code]) => code === prefix);
    if (match) stateSelect.value = prefix;
  }
});

const bPincodeInput = document.getElementById('b_pincode');
const bPincodeError = document.getElementById('bPincodeError');
bPincodeInput.addEventListener('input', () => {
  bPincodeInput.value = bPincodeInput.value.replace(/[^0-9]/g, '').slice(0, 6);
  validateField(bPincodeInput, bPincodeError, PINCODE_PATTERN, 'Pincode must be exactly 6 digits.');
});

const iPincodeInput = document.getElementById('i_pincode');
const iPincodeError = document.getElementById('iPincodeError');
iPincodeInput.addEventListener('input', () => {
  iPincodeInput.value = iPincodeInput.value.replace(/[^0-9]/g, '').slice(0, 6);
  validateField(iPincodeInput, iPincodeError, PINCODE_PATTERN, 'Pincode must be exactly 6 digits.');
});

const displayNameSelect = document.getElementById('f_displayName');
const displayNameError = document.getElementById('displayNameError');
const nameInput = document.getElementById('f_name');
const companyInput = document.getElementById('f_company');

// Display name can only be either the contact name or the company name —
// never free text — so this rebuilds the dropdown live as those fields change,
// while trying to keep whichever one (name vs company) was already selected.
function refreshDisplayNameOptions() {
  const previousChoice = displayNameSelect.value; // 'name' or 'company'
  const nameVal = nameInput.value.trim();
  const companyVal = companyInput.value.trim();

  const options = [];
  if (nameVal) options.push({ value: 'name', label: nameVal });
  if (companyVal) options.push({ value: 'company', label: companyVal });

  displayNameSelect.innerHTML = options.length
    ? options.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')
    : '<option value="">— Enter a name first —</option>';

  // Keep the previous choice if it's still available; otherwise default to
  // company name when present (typical for invoicing a business), else name.
  if (options.some((o) => o.value === previousChoice)) {
    displayNameSelect.value = previousChoice;
  } else if (companyVal) {
    displayNameSelect.value = 'company';
  } else if (nameVal) {
    displayNameSelect.value = 'name';
  }

  displayNameError.style.display = 'none';
  displayNameSelect.classList.remove('invalid');
}
nameInput.addEventListener('input', refreshDisplayNameOptions);
companyInput.addEventListener('input', refreshDisplayNameOptions);

function currentDisplayNameValue() {
  return displayNameSelect.value === 'company' ? companyInput.value.trim() : nameInput.value.trim();
}

let customers = [];

function displayNameFor(c) {
  return c.displayName || c.companyName || c.name;
}

async function loadCustomers() {
  const res = await fetch('/api/customers', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) {
    window.location.href = '/login.html';
    return;
  }
  customers = await res.json();
  renderCustomerRows(customers);
}

function renderCustomerRows(list) {
  const rows = list.map((c) => `
    <tr>
      <td>${c.customerCode}</td>
      <td>${displayNameFor(c)}</td>
      <td>${TIER_LABELS[c.tier] || c.tier}</td>
      <td>${c.parent ? displayNameFor(c.parent) : '<span style="color:#999">MNR (root)</span>'}</td>
      <td>${c.name}</td>
      <td>${c.gstin || '—'}</td>
      <td>${c.state || '—'}</td>
      <td><button class="editLink" data-id="${c.id}">Edit</button></td>
    </tr>
  `).join('');
  document.getElementById('customerRows').innerHTML = rows || '<tr><td colspan="8">No matching customers.</td></tr>';

  document.querySelectorAll('.editLink').forEach((btn) => {
    btn.addEventListener('click', () => openEditModal(btn.dataset.id));
  });
}

document.getElementById('searchInput').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) { renderCustomerRows(customers); return; }
  const filtered = customers.filter((c) => [
    c.customerCode, displayNameFor(c), c.name, c.companyName, c.gstin, c.state, TIER_LABELS[c.tier],
  ].filter(Boolean).join(' ').toLowerCase().includes(q));
  renderCustomerRows(filtered);
});

const modalBg = document.getElementById('modalBg');
const modalTitle = document.getElementById('modalTitle');
const codeInput = document.getElementById('f_code');

function resetModalFields() {
  ['f_id', 'f_code', 'f_name', 'f_company', 'f_gstin', 'b_line1', 'b_city', 'b_pincode', 'i_line1', 'i_city', 'i_pincode', 'f_portalEmail', 'f_portalPassword']
    .forEach((id) => document.getElementById(id).value = '');
  document.getElementById('sameAsBilling').checked = true;
  document.getElementById('installationFields').style.display = 'none';
  stateSelect.value = '27';
  codeInput.disabled = false;
  tierSelect.value = 'CUSTOMER';
  refreshParentOptions();
  refreshDisplayNameOptions();
  document.getElementById('portalPasswordHint').textContent = '';
  [gstinInput, bPincodeInput, iPincodeInput].forEach((el) => el.classList.remove('invalid'));
  [displayNameError, gstinError, bPincodeError, iPincodeError, parentError, document.getElementById('portalError'), document.getElementById('modalError')].forEach((el) => el.style.display = 'none');
}

document.getElementById('addBtn').addEventListener('click', () => {
  resetModalFields();
  modalTitle.textContent = 'Add customer';
  modalBg.style.display = 'flex';
});

function openEditModal(customerId) {
  const c = customers.find((x) => x.id === customerId);
  if (!c) return;
  resetModalFields();
  modalTitle.textContent = `Edit ${c.name}`;
  document.getElementById('f_id').value = c.id;
  codeInput.value = c.customerCode;
  codeInput.disabled = true; // customer code isn't editable once created
  tierSelect.value = c.tier || 'CUSTOMER';
  refreshParentOptions();
  if (c.parentCustomerId) parentSelect.value = c.parentCustomerId;
  document.getElementById('f_name').value = c.name;
  document.getElementById('f_company').value = c.companyName || '';
  refreshDisplayNameOptions();
  if (c.displayName === c.companyName && c.companyName) displayNameSelect.value = 'company';
  else displayNameSelect.value = 'name';
  document.getElementById('f_gstin').value = c.gstin || '';
  if (c.stateCode) stateSelect.value = c.stateCode;
  document.getElementById('f_portalEmail').value = c.portalEmail || '';
  document.getElementById('portalPasswordHint').textContent = c.portalEmail
    ? '(portal login is set up — leave blank to keep the current password)'
    : '(leave blank to keep unchanged)';

  const billing = (c.addresses || []).find((a) => a.type === 'BILLING');
  const installation = (c.addresses || []).find((a) => a.type === 'INSTALLATION');
  if (billing) {
    document.getElementById('b_line1').value = billing.line1 || '';
    document.getElementById('b_city').value = billing.city || '';
    document.getElementById('b_pincode').value = billing.pincode || '';
  }
  if (installation) {
    document.getElementById('sameAsBilling').checked = false;
    document.getElementById('installationFields').style.display = 'block';
    document.getElementById('i_line1').value = installation.line1 || '';
    document.getElementById('i_city').value = installation.city || '';
    document.getElementById('i_pincode').value = installation.pincode || '';
  }

  modalBg.style.display = 'flex';
}

document.getElementById('cancelBtn').addEventListener('click', () => { modalBg.style.display = 'none'; });

document.getElementById('saveBtn').addEventListener('click', async () => {
  const errorBox = document.getElementById('modalError');
  errorBox.style.display = 'none';

  const editingId = document.getElementById('f_id').value;
  const displayNameValue = currentDisplayNameValue();
  const gstinValue = gstinInput.value.trim();
  const bPincodeValue = bPincodeInput.value.trim();
  const sameAsBilling = document.getElementById('sameAsBilling').checked;
  const iPincodeValue = sameAsBilling ? '' : iPincodeInput.value.trim();

  const problems = [];
  if (!displayNameValue) problems.push('Display name is required.');
  if (gstinValue && !GSTIN_PATTERN.test(gstinValue)) problems.push('GSTIN is not valid (needs to be exactly 15 characters).');
  if (bPincodeValue && !PINCODE_PATTERN.test(bPincodeValue)) problems.push('Billing pincode must be exactly 6 digits.');
  if (iPincodeValue && !PINCODE_PATTERN.test(iPincodeValue)) problems.push('Installation pincode must be exactly 6 digits.');
  if (REQUIRED_PARENT_TIER[tierSelect.value] !== null && !parentSelect.value) {
    problems.push(`${TIER_LABELS[tierSelect.value]} requires a parent ${TIER_LABELS[REQUIRED_PARENT_TIER[tierSelect.value]]} — none exists yet, so add one of those first.`);
  }
  const portalEmailValue = document.getElementById('f_portalEmail').value.trim();
  const portalPasswordValue = document.getElementById('f_portalPassword').value;
  if (portalPasswordValue && !portalEmailValue) problems.push('Enter a portal email before setting a portal password.');
  if (portalPasswordValue && portalPasswordValue.length < 8) problems.push('Portal password must be at least 8 characters.');

  if (problems.length > 0) {
    errorBox.textContent = problems.join(' ');
    errorBox.style.display = 'block';
    return;
  }

  const stateCode = stateSelect.value;
  const stateName = GST_STATES.find(([code]) => code === stateCode)?.[1];

  const billingAddress = {
    line1: document.getElementById('b_line1').value || undefined,
    city: document.getElementById('b_city').value || undefined,
    pincode: document.getElementById('b_pincode').value || undefined,
  };
  const installationAddress = sameAsBilling ? undefined : {
    line1: document.getElementById('i_line1').value || undefined,
    city: document.getElementById('i_city').value || undefined,
    pincode: document.getElementById('i_pincode').value || undefined,
  };

  const body = {
    displayName: displayNameValue,
    tier: tierSelect.value,
    parentCustomerId: REQUIRED_PARENT_TIER[tierSelect.value] === null ? null : (parentSelect.value || null),
    name: document.getElementById('f_name').value,
    companyName: document.getElementById('f_company').value || undefined,
    gstin: document.getElementById('f_gstin').value || undefined,
    state: stateName,
    stateCode,
    billingAddress,
    installationAddress,
    portalEmail: portalEmailValue || undefined,
    portalPassword: portalPasswordValue || undefined,
  };

  let res;
  if (editingId) {
    res = await fetch(`/api/customers/${editingId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  } else {
    body.customerCode = document.getElementById('f_code').value;
    res = await fetch('/api/customers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }
  const data = await res.json();

  if (!res.ok) {
    errorBox.textContent = data.error || 'Could not save customer';
    errorBox.style.display = 'block';
    return;
  }

  modalBg.style.display = 'none';
  loadCustomers();
});

loadCustomers();
