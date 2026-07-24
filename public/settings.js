const token = localStorage.getItem('mnr_token');
const user = JSON.parse(localStorage.getItem('mnr_user') || 'null');
if (!token || !user) window.location.href = '/login.html';

document.getElementById('whoAmI').textContent = `${user.name} (${user.role})`;
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('mnr_token');
  localStorage.removeItem('mnr_user');
  window.location.href = '/login.html';
});

function showStatus(el, message, isError) {
  el.textContent = message;
  el.className = 'statusMsg ' + (isError ? 'error' : 'success');
  el.style.display = 'block';
  setTimeout(() => { el.style.display = 'none'; }, 4000);
}

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
const companyStateSelect = document.getElementById('f_companyState');
companyStateSelect.innerHTML = GST_STATES.map(([code, name]) => `<option value="${code}">${name} (${code})</option>`).join('');

const PINCODE_PATTERN = /^[0-9]{6}$/;
const GSTIN_PATTERN = /^[0-9]{2}[A-Z0-9]{13}$/;

const companyGstinInput = document.getElementById('f_gstin');
const companyGstinError = document.getElementById('companyGstinError');
companyGstinInput.addEventListener('input', () => {
  companyGstinInput.value = companyGstinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
  const value = companyGstinInput.value;
  let message = '';
  if (value.length >= 1 && !/^[0-9]/.test(value)) message = 'GSTIN must start with 2 digits (the state code).';
  else if (value.length === 15 && !GSTIN_PATTERN.test(value)) message = 'GSTIN must be exactly 15 characters: 2 digits followed by 13 letters/numbers.';
  companyGstinInput.classList.toggle('invalid', message !== '');
  companyGstinError.textContent = message;
  companyGstinError.style.display = message ? 'block' : 'none';

  // Auto-select the matching state once the first two digits form a real GST state code
  if (/^[0-9]{2}/.test(value)) {
    const prefix = value.slice(0, 2);
    if (GST_STATES.some(([code]) => code === prefix)) companyStateSelect.value = prefix;
  }
});

const pincodeInput = document.getElementById('f_pincode');
const pincodeError = document.getElementById('pincodeError');
pincodeInput.addEventListener('input', () => {
  pincodeInput.value = pincodeInput.value.replace(/[^0-9]/g, '').slice(0, 6);
  const valid = pincodeInput.value === '' || PINCODE_PATTERN.test(pincodeInput.value);
  pincodeInput.classList.toggle('invalid', !valid);
  pincodeError.textContent = valid ? '' : 'Pincode must be exactly 6 digits.';
  pincodeError.style.display = valid ? 'none' : 'block';
});

async function loadCompany() {
  const res = await fetch('/api/company', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  const c = await res.json();

  document.getElementById('f_name').value = c.name || '';
  document.getElementById('f_legalName').value = c.legalName || '';
  document.getElementById('f_gstin').value = c.gstin || '';
  document.getElementById('f_pan').value = c.pan || '';
  document.getElementById('f_cin').value = c.cin || '';
  document.getElementById('f_address').value = c.registeredAddress || '';
  document.getElementById('f_city').value = c.city || '';
  if (c.stateCode) companyStateSelect.value = c.stateCode;
  document.getElementById('f_country').value = c.country || 'India';
  document.getElementById('f_pincode').value = c.pincode || '';
  document.getElementById('f_email').value = c.contactEmail || '';
  document.getElementById('f_phone').value = c.contactPhone || '';
  document.getElementById('f_terms').value = c.termsAndConditions || '';

  const bank = c.bankDetails || {};
  document.getElementById('f_bankAccountName').value = bank.accountName || '';
  document.getElementById('f_bankAccountNumber').value = bank.accountNumber || '';
  document.getElementById('f_bankName').value = bank.bankName || '';
  document.getElementById('f_bankIfsc').value = bank.ifsc || '';
  document.getElementById('f_bankBranch').value = bank.branch || '';

  document.getElementById('f_razorpayKeyId').value = c.razorpayKeyId || '';
  document.getElementById('secretHint').textContent = c.razorpayKeySecretSet ? '(already set — leave blank to keep it)' : '(not set yet)';
  document.getElementById('gatewayStatus').className = 'statusMsg ' + (c.razorpayKeyId && c.razorpayKeySecretSet ? 'success' : '');
  document.getElementById('gatewayStatus').textContent = c.razorpayKeyId && c.razorpayKeySecretSet
    ? 'Online top-up is enabled in the Partner Portal.'
    : 'Online top-up is disabled until both fields are filled in.';

  document.getElementById('f_resendFromEmail').value = c.resendFromEmail || '';
  document.getElementById('f_resendFromName').value = c.resendFromName || '';
  document.getElementById('resendSecretHint').textContent = c.resendApiKeySet ? '(already set — leave blank to keep it)' : '(not set yet)';
  const emailReady = c.resendApiKeySet && c.resendFromEmail;
  document.getElementById('emailStatus').className = 'statusMsg ' + (emailReady ? 'success' : '');
  document.getElementById('emailStatus').textContent = emailReady
    ? 'Email sending is enabled.'
    : 'Email sending is disabled until an API Key and "From" email are both set.';

  // E-invoicing
  document.getElementById('f_eInvoicingEnabled').checked = !!c.eInvoicingEnabled;
  document.getElementById('f_irpApiKey').value = c.irpApiKey || '';
  document.getElementById('f_irpUsername').value = c.irpUsername || '';
  document.getElementById('irpPasswordHint').textContent = c.irpPasswordSet ? '(already set — leave blank to keep it)' : '(not set yet)';
  document.getElementById('einvoiceStatus').className = 'statusMsg ' + (c.eInvoicingEnabled ? 'success' : '');
  document.getElementById('einvoiceStatus').textContent = c.eInvoicingEnabled
    ? 'E-Invoicing is ENABLED. IRN will be generated for all GST invoices.'
    : 'E-Invoicing is disabled. Enable it when your company exceeds ₹5 Crore annual turnover.';

  // Height8
  document.getElementById('f_height8Enabled').checked = !!c.height8Enabled;
  document.getElementById('f_height8ApiUrl').value = c.height8ApiUrl || '';
  document.getElementById('f_height8Username').value = c.height8Username || '';
  document.getElementById('height8PasswordHint').textContent = c.height8PasswordSet ? '(already set — leave blank to keep it)' : '(not set yet)';
  document.getElementById('height8Status').className = 'statusMsg ' + (c.height8Enabled ? 'success' : '');
  document.getElementById('height8Status').textContent = c.height8Enabled
    ? 'Height8 Integration is ENABLED. Top-ups will be pushed to the Height8 API.'
    : 'Height8 Integration is disabled.';

  renderLogo(c.logoUrl);
}

function renderLogo(logoUrl) {
  const preview = document.getElementById('logoPreview');
  preview.innerHTML = logoUrl
    ? `<img src="${logoUrl}?t=${Date.now()}" alt="Company logo">`
    : '<span class="placeholder">No logo yet</span>';
}

document.getElementById('uploadBtn').addEventListener('click', () => document.getElementById('logoInput').click());

document.getElementById('logoInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('logoStatus');

  const formData = new FormData();
  formData.append('logo', file);

  const res = await fetch('/api/company/logo', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` }, // no Content-Type — browser sets the multipart boundary itself
    body: formData,
  });
  const data = await res.json();

  if (!res.ok) {
    showStatus(statusEl, data.error || 'Could not upload logo', true);
    return;
  }
  renderLogo(data.logoUrl);
  showStatus(statusEl, 'Logo updated.', false);
  e.target.value = '';
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const statusEl = document.getElementById('saveStatus');
  const gstin = document.getElementById('f_gstin').value.trim();
  const pincode = pincodeInput.value.trim();

  if (gstin && !GSTIN_PATTERN.test(gstin.toUpperCase())) {
    showStatus(statusEl, 'GSTIN must be exactly 15 characters: 2 digits followed by 13 letters/numbers.', true);
    return;
  }
  if (pincode && !PINCODE_PATTERN.test(pincode)) {
    showStatus(statusEl, 'Pincode must be exactly 6 digits.', true);
    return;
  }

  const stateCode = companyStateSelect.value;
  const stateName = GST_STATES.find(([code]) => code === stateCode)?.[1];

  const body = {
    name: document.getElementById('f_name').value,
    legalName: document.getElementById('f_legalName').value || undefined,
    gstin: gstin.toUpperCase() || undefined,
    pan: document.getElementById('f_pan').value.toUpperCase() || undefined,
    cin: document.getElementById('f_cin').value || undefined,
    registeredAddress: document.getElementById('f_address').value || undefined,
    city: document.getElementById('f_city').value || undefined,
    state: stateName,
    stateCode,
    country: document.getElementById('f_country').value || 'India',
    pincode: pincode || undefined,
    contactEmail: document.getElementById('f_email').value || undefined,
    contactPhone: document.getElementById('f_phone').value || undefined,
    termsAndConditions: document.getElementById('f_terms').value || undefined,
    bankDetails: {
      accountName: document.getElementById('f_bankAccountName').value || undefined,
      accountNumber: document.getElementById('f_bankAccountNumber').value || undefined,
      bankName: document.getElementById('f_bankName').value || undefined,
      ifsc: document.getElementById('f_bankIfsc').value || undefined,
      branch: document.getElementById('f_bankBranch').value || undefined,
    },
    razorpayKeyId: document.getElementById('f_razorpayKeyId').value,
    ...(document.getElementById('f_razorpayKeySecret').value
      ? { razorpayKeySecret: document.getElementById('f_razorpayKeySecret').value }
      : {}),
    resendFromEmail: document.getElementById('f_resendFromEmail').value || undefined,
    resendFromName: document.getElementById('f_resendFromName').value || undefined,
    ...(document.getElementById('f_resendApiKey').value
      ? { resendApiKey: document.getElementById('f_resendApiKey').value }
      : {}),
    // E-invoicing
    eInvoicingEnabled: document.getElementById('f_eInvoicingEnabled').checked,
    irpApiKey: document.getElementById('f_irpApiKey').value || undefined,
    irpUsername: document.getElementById('f_irpUsername').value || undefined,
    ...(document.getElementById('f_irpPassword').value
      ? { irpPassword: document.getElementById('f_irpPassword').value }
      : {}),
    // Height8
    height8Enabled: document.getElementById('f_height8Enabled').checked,
    height8ApiUrl: document.getElementById('f_height8ApiUrl').value || undefined,
    height8Username: document.getElementById('f_height8Username').value || undefined,
    ...(document.getElementById('f_height8Password').value
      ? { height8Password: document.getElementById('f_height8Password').value }
      : {}),
  };

  const res = await fetch('/api/company', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) {
    showStatus(statusEl, data.error || 'Could not save settings', true);
    return;
  }
  document.getElementById('f_razorpayKeySecret').value = '';
  document.getElementById('f_resendApiKey').value = '';
  document.getElementById('f_irpPassword').value = '';
  document.getElementById('f_height8Password').value = '';
  showStatus(statusEl, 'Settings saved.', false);
  loadCompany();
});

loadCompany();
