const stateSelect = document.getElementById('f_state');
stateSelect.innerHTML = GST_STATES.map(([code, name]) => `<option value="${code}">${name} (${code})</option>`).join('');
stateSelect.value = '27';

const childTier = NEXT_TIER_DOWN[portalCustomer.tier];

async function loadCustomers() {
  if (!childTier) {
    document.getElementById('gateNote').textContent = 'Customers are the bottom of the hierarchy and cannot have their own downline.';
    document.getElementById('gateNote').style.display = 'block';
    document.getElementById('addBtn').style.display = 'none';
    document.getElementById('customerRows').innerHTML = '<tr><td colspan="7" class="empty">Nothing to show.</td></tr>';
    return;
  }

  const res = await portalFetch('/api/portal/downline');
  const downline = await res.json();
  document.getElementById('customerRows').innerHTML = downline.length
    ? downline.map((c) => `
        <tr>
          <td>${c.customerCode}</td>
          <td>${c.displayName}</td>
          <td>${TIER_LABELS[c.tier] || c.tier}</td>
          <td>${c.gstin || '—'}</td>
          <td>${c.state || '—'}</td>
          <td class="num">${formatRupees(c.balance)}</td>
          <td>${c.hasPortalLogin ? '✓ Enabled' : '—'}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="7" class="empty">No customers yet — add your first one.</td></tr>';
}

const modalBg = document.getElementById('modalBg');
document.getElementById('addBtn').addEventListener('click', () => {
  document.getElementById('tierNote').textContent = `This will be created as a ${TIER_LABELS[childTier]} under you.`;
  ['f_name', 'f_company', 'f_gstin', 'b_line1', 'b_city', 'b_pincode', 'f_portalEmail', 'f_portalPassword']
    .forEach((id) => document.getElementById(id).value = '');
  stateSelect.value = '27';
  refreshDisplayNameOptions();
  document.getElementById('modalError').style.display = 'none';
  modalBg.style.display = 'flex';
});
document.getElementById('cancelBtn').addEventListener('click', () => { modalBg.style.display = 'none'; });

document.getElementById('f_gstin').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 15);
  if (/^[0-9]{2}/.test(e.target.value)) {
    const prefix = e.target.value.slice(0, 2);
    if (GST_STATES.some(([code]) => code === prefix)) stateSelect.value = prefix;
  }
});
document.getElementById('b_pincode').addEventListener('input', (e) => {
  e.target.value = e.target.value.replace(/[^0-9]/g, '').slice(0, 6);
});

// Display name can only be either the contact name or the company name —
// never free text — mirroring the same rule enforced in the admin app.
const displayNameSelect = document.getElementById('f_displayName');
const displayNameError = document.getElementById('displayNameError');
const nameInput = document.getElementById('f_name');
const companyInput = document.getElementById('f_company');

function refreshDisplayNameOptions() {
  const previousChoice = displayNameSelect.value;
  const nameVal = nameInput.value.trim();
  const companyVal = companyInput.value.trim();

  const options = [];
  if (nameVal) options.push({ value: 'name', label: nameVal });
  if (companyVal) options.push({ value: 'company', label: companyVal });

  displayNameSelect.innerHTML = options.length
    ? options.map((o) => `<option value="${o.value}">${o.label}</option>`).join('')
    : '<option value="">— Enter a name first —</option>';

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

document.getElementById('saveBtn').addEventListener('click', async () => {
  const errorBox = document.getElementById('modalError');
  errorBox.style.display = 'none';

  const displayName = currentDisplayNameValue();
  const name = document.getElementById('f_name').value.trim();

  let hasError = false;
  if (!displayName) {
    displayNameSelect.classList.add('invalid');
    displayNameError.textContent = 'Display name is required — enter a contact name or company name first.';
    displayNameError.style.display = 'block';
    hasError = true;
  }
  if (!name) {
    errorBox.textContent = 'Contact / person name is required.';
    errorBox.style.display = 'block';
    hasError = true;
  }
  if (hasError) return;

  const stateCode = stateSelect.value;
  const stateName = GST_STATES.find(([code]) => code === stateCode)?.[1];

  const body = {
    name,
    displayName,
    companyName: document.getElementById('f_company').value || undefined,
    gstin: document.getElementById('f_gstin').value || undefined,
    state: stateName,
    stateCode,
    billingAddress: {
      line1: document.getElementById('b_line1').value || undefined,
      city: document.getElementById('b_city').value || undefined,
      pincode: document.getElementById('b_pincode').value || undefined,
    },
    portalEmail: document.getElementById('f_portalEmail').value || undefined,
    portalPassword: document.getElementById('f_portalPassword').value || undefined,
  };

  const res = await portalFetch('/api/portal/customers', { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { errorBox.textContent = data.error || 'Could not add customer'; errorBox.style.display = 'block'; return; }

  modalBg.style.display = 'none';
  loadCustomers();
});

loadCustomers();
