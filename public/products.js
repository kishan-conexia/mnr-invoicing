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

function formatRupees(amount) {
  return Number(amount).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let allProducts = [];

async function loadProducts() {
  const res = await fetch('/api/products', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  allProducts = await res.json();
  renderProductRows(allProducts);
}

function renderProductRows(list) {
  const rows = list.map((p) => `
    <tr>
      <td>${p.code}</td>
      <td>${p.name}</td>
      <td>${p.hsnSac || '—'}</td>
      <td>${p.unit}</td>
      <td>₹${formatRupees(p.standardRate)}</td>
      <td>${p.taxRate ? p.taxRate.name : '—'}</td>
      <td>${p.billingFrequency || 'One-time'}</td>
    </tr>
  `).join('');
  document.getElementById('productRows').innerHTML = rows || '<tr><td colspan="7">No matching services.</td></tr>';
}

document.getElementById('searchInput').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) { renderProductRows(allProducts); return; }
  const filtered = allProducts.filter((p) => [p.code, p.name, p.hsnSac, p.taxRate?.name, p.billingFrequency]
    .filter(Boolean).join(' ').toLowerCase().includes(q));
  renderProductRows(filtered);
});

async function loadTaxRates() {
  const res = await fetch('/api/tax-rates', { headers: { Authorization: `Bearer ${token}` } });
  const rates = await res.json();
  const select = document.getElementById('f_tax');
  select.innerHTML = rates.map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
}

const modalBg = document.getElementById('modalBg');
document.getElementById('addBtn').addEventListener('click', () => { modalBg.style.display = 'flex'; });
document.getElementById('cancelBtn').addEventListener('click', () => { modalBg.style.display = 'none'; });

document.getElementById('saveBtn').addEventListener('click', async () => {
  const errorBox = document.getElementById('modalError');
  errorBox.style.display = 'none';

  const body = {
    code: document.getElementById('f_code').value,
    name: document.getElementById('f_name').value,
    hsnSac: document.getElementById('f_hsn').value || undefined,
    unit: document.getElementById('f_unit').value || 'NOS',
    standardRate: document.getElementById('f_rate').value,
    taxRateId: document.getElementById('f_tax').value || undefined,
    billingFrequency: document.getElementById('f_freq').value || undefined,
  };

  const res = await fetch('/api/products', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) {
    errorBox.textContent = data.error || 'Could not save service';
    errorBox.style.display = 'block';
    return;
  }

  modalBg.style.display = 'none';
  ['f_code', 'f_name', 'f_hsn', 'f_rate'].forEach((id) => document.getElementById(id).value = '');
  document.getElementById('f_unit').value = 'NOS';
  loadProducts();
});

loadTaxRates();
loadProducts();
