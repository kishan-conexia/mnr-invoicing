const token = localStorage.getItem('mnr_token');
const user = JSON.parse(localStorage.getItem('mnr_user') || 'null');
if (!token || !user) window.location.href = '/login.html';

document.getElementById('whoAmI').textContent = `${user.name} (${user.role})`;
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('mnr_token');
  localStorage.removeItem('mnr_user');
  window.location.href = '/login.html';
});

async function authedFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) { window.location.href = '/login.html'; throw new Error('logged out'); }
  return res;
}

function formatRupees(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayStr() { return new Date().toISOString().slice(0, 10); }
document.getElementById('f_date').value = todayStr();

let customers = [];

async function loadCustomers() {
  const res = await authedFetch('/api/customers');
  customers = await res.json();
  const select = document.getElementById('f_customer');
  select.innerHTML = '<option value="">— Select customer —</option>' +
    customers.map((c) => `<option value="${c.id}">${c.name}${c.companyName ? ' — ' + c.companyName : ''}</option>`).join('');
  select.addEventListener('change', () => { loadOutstandingInvoices(); updateWalletBalanceNote(); });
  document.getElementById('f_mode').addEventListener('change', updateWalletBalanceNote);
}

let currentWalletBalance = null;

async function updateWalletBalanceNote() {
  const note = document.getElementById('walletBalanceNote');
  const customerId = document.getElementById('f_customer').value;
  const mode = document.getElementById('f_mode').value;
  currentWalletBalance = null;

  if (mode !== 'WALLET' || !customerId) {
    note.style.display = 'none';
    return;
  }
  const res = await authedFetch(`/api/wallets/${customerId}`);
  const data = await res.json();
  currentWalletBalance = Number(data.balance);
  note.textContent = `Current wallet balance: ₹${currentWalletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
  note.style.display = 'block';
}

async function loadOutstandingInvoices() {
  const customerId = document.getElementById('f_customer').value;
  const tbody = document.getElementById('invoiceRows');
  if (!customerId) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:#999">Pick a customer to see their invoices.</td></tr>';
    recalcUnallocated();
    return;
  }

  const res = await authedFetch(`/api/invoices?customerId=${customerId}`);
  const invoices = await res.json();
  const outstanding = invoices.filter((inv) => inv.status !== 'CANCELLED' && (Number(inv.totalValue) - Number(inv.amountPaid)) > 0.01);

  if (outstanding.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:#999">This customer has no outstanding invoices.</td></tr>';
    recalcUnallocated();
    return;
  }

  tbody.innerHTML = outstanding.map((inv) => {
    const due = Number(inv.totalValue) - Number(inv.amountPaid);
    return `
      <tr data-invoice-id="${inv.id}" data-outstanding="${due}">
        <td>${inv.invoiceNumber}</td>
        <td>${new Date(inv.invoiceDate).toLocaleDateString('en-IN')}</td>
        <td class="num">₹${formatRupees(inv.totalValue)}</td>
        <td class="num">₹${formatRupees(due)}</td>
        <td class="num"><input type="number" class="alloc-input" min="0" max="${due}" step="0.01" value="0"></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.alloc-input').forEach((input) => input.addEventListener('input', recalcUnallocated));
  recalcUnallocated();
}

document.getElementById('f_amount').addEventListener('input', recalcUnallocated);

function recalcUnallocated() {
  const amount = Number(document.getElementById('f_amount').value) || 0;
  const rows = [...document.querySelectorAll('#invoiceRows tr[data-invoice-id]')];
  const allocated = rows.reduce((sum, row) => sum + (Number(row.querySelector('.alloc-input').value) || 0), 0);
  const remaining = Math.round((amount - allocated) * 100) / 100;

  const note = document.getElementById('unallocatedNote');
  note.textContent = remaining >= 0
    ? `Unallocated amount: ₹${formatRupees(remaining)} ${remaining > 0 ? '(will be recorded as an advance / unallocated credit)' : ''}`
    : `Allocated amount exceeds the payment received by ₹${formatRupees(-remaining)}`;
  note.classList.toggle('over', remaining < 0);
}

// "Fill remaining" helper: click an outstanding cell's row to auto-fill it up to
// either the full outstanding or whatever's left of the payment, whichever is smaller.
document.getElementById('invoiceRows').addEventListener('dblclick', (e) => {
  const row = e.target.closest('tr[data-invoice-id]');
  if (!row) return;
  const outstanding = Number(row.dataset.outstanding);
  const amount = Number(document.getElementById('f_amount').value) || 0;
  const rows = [...document.querySelectorAll('#invoiceRows tr[data-invoice-id]')];
  const alreadyAllocatedElsewhere = rows.filter((r) => r !== row).reduce((s, r) => s + (Number(r.querySelector('.alloc-input').value) || 0), 0);
  const remaining = Math.max(0, amount - alreadyAllocatedElsewhere);
  row.querySelector('.alloc-input').value = Math.min(outstanding, remaining).toFixed(2);
  recalcUnallocated();
});

document.getElementById('saveBtn').addEventListener('click', async () => {
  const errorBox = document.getElementById('errorBox');
  errorBox.style.display = 'none';

  const customerId = document.getElementById('f_customer').value;
  const amount = document.getElementById('f_amount').value;

  if (!customerId || !amount || Number(amount) <= 0) {
    errorBox.textContent = 'Pick a customer and enter a payment amount greater than zero.';
    errorBox.style.display = 'block';
    return;
  }

  const mode = document.getElementById('f_mode').value;
  if (mode === 'WALLET' && currentWalletBalance !== null && Number(amount) > currentWalletBalance + 0.01) {
    errorBox.textContent = `Wallet balance (₹${currentWalletBalance.toLocaleString('en-IN', { minimumFractionDigits: 2 })}) is less than this payment amount.`;
    errorBox.style.display = 'block';
    return;
  }

  const allocations = [...document.querySelectorAll('#invoiceRows tr[data-invoice-id]')]
    .map((row) => ({ invoiceId: row.dataset.invoiceId, amount: Number(row.querySelector('.alloc-input').value) || 0 }))
    .filter((a) => a.amount > 0);

  const body = {
    customerId,
    paymentDate: document.getElementById('f_date').value,
    amount,
    mode: document.getElementById('f_mode').value,
    referenceNumber: document.getElementById('f_reference').value || undefined,
    notes: document.getElementById('f_notes').value || undefined,
    allocations,
  };

  const res = await authedFetch('/api/payments', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();

  if (!res.ok) {
    errorBox.textContent = data.error || 'Could not save payment';
    errorBox.style.display = 'block';
    return;
  }

  window.location.href = `/receipt-view.html?id=${data.id}`;
});

loadCustomers();
