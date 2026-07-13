const token = localStorage.getItem('mnr_token');
const user = JSON.parse(localStorage.getItem('mnr_user') || 'null');
if (!token || !user) window.location.href = '/login.html';

document.getElementById('whoAmI').textContent = `${user.name} (${user.role})`;
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('mnr_token');
  localStorage.removeItem('mnr_user');
  window.location.href = '/login.html';
});

const TIER_LABELS = { DISTRIBUTOR_L1: 'Distributor L1', DISTRIBUTOR_L2: 'Distributor L2', PARTNER: 'Partner', CUSTOMER: 'Customer' };
const TYPE_LABELS = { TOPUP: 'Top up', TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out', INVOICE_PAYMENT: 'Invoice payment', ADJUSTMENT: 'Adjustment' };

const customerId = new URLSearchParams(window.location.search).get('customerId');

function formatRupees(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDateTime(d) {
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function authedFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) { window.location.href = '/login.html'; throw new Error('logged out'); }
  return res;
}

let currentBalance = 0;

async function load() {
  if (!customerId) { document.getElementById('customerName').textContent = 'No wallet specified.'; return; }

  const res = await authedFetch(`/api/wallets/${customerId}`);
  if (!res.ok) { document.getElementById('customerName').textContent = 'Wallet not found.'; return; }
  const data = await res.json();
  const c = data.customer;
  currentBalance = Number(data.balance);

  document.getElementById('customerName').textContent = c.displayName || c.companyName || c.name;
  document.getElementById('tierBadge').textContent = TIER_LABELS[c.tier];
  document.getElementById('tierBadge').className = `tierBadge ${c.tier}`;

  const balanceEl = document.getElementById('balanceValue');
  balanceEl.textContent = `₹${formatRupees(currentBalance)}`;
  balanceEl.classList.toggle('negative', currentBalance < 0);

  document.getElementById('txnRows').innerHTML = data.transactions.length
    ? data.transactions.map((t) => `
        <tr>
          <td>${formatDateTime(t.createdAt)}</td>
          <td><span class="typeTag ${t.type}">${TYPE_LABELS[t.type]}</span></td>
          <td class="num">${['TRANSFER_OUT', 'INVOICE_PAYMENT'].includes(t.type) ? '−' : '+'}₹${formatRupees(t.amount)}</td>
          <td class="num">₹${formatRupees(t.balanceAfter)}</td>
          <td>${t.notes || '—'}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="5" class="empty">No transactions yet.</td></tr>';

  // Only show "Transfer to child" if this customer's tier can actually have children
  // (i.e. isn't the bottom-level Customer tier).
  document.getElementById('transferBtn').style.display = c.tier === 'CUSTOMER' ? 'none' : 'inline-block';
}

// ── Top up ──────────────────────────────────────────────
const topupModal = document.getElementById('topupModal');
document.getElementById('topupBtn').addEventListener('click', () => {
  document.getElementById('tu_amount').value = '';
  document.getElementById('tu_notes').value = '';
  document.getElementById('tu_error').style.display = 'none';
  topupModal.style.display = 'flex';
});
document.getElementById('tu_cancel').addEventListener('click', () => { topupModal.style.display = 'none'; });
document.getElementById('tu_save').addEventListener('click', async () => {
  const errorBox = document.getElementById('tu_error');
  const amount = document.getElementById('tu_amount').value;
  if (!amount || Number(amount) <= 0) {
    errorBox.textContent = 'Enter an amount greater than zero.';
    errorBox.style.display = 'block';
    return;
  }
  const res = await authedFetch(`/api/wallets/${customerId}/topup`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ amount, notes: document.getElementById('tu_notes').value || undefined }),
  });
  const data = await res.json();
  if (!res.ok) { errorBox.textContent = data.error || 'Could not top up'; errorBox.style.display = 'block'; return; }
  topupModal.style.display = 'none';
  load();
});

// ── Transfer to child ───────────────────────────────────
const transferModal = document.getElementById('transferModal');
document.getElementById('transferBtn').addEventListener('click', async () => {
  const res = await authedFetch('/api/customers');
  const allCustomers = await res.json();
  const children = allCustomers.filter((c) => c.parentCustomerId === customerId);

  const select = document.getElementById('tr_child');
  select.innerHTML = children.length
    ? children.map((c) => `<option value="${c.id}">${c.displayName || c.companyName || c.name}</option>`).join('')
    : '<option value="">— No children under this wallet yet —</option>';

  document.getElementById('tr_amount').value = '';
  document.getElementById('tr_notes').value = '';
  document.getElementById('tr_error').style.display = 'none';
  transferModal.style.display = 'flex';
});
document.getElementById('tr_cancel').addEventListener('click', () => { transferModal.style.display = 'none'; });
document.getElementById('tr_save').addEventListener('click', async () => {
  const errorBox = document.getElementById('tr_error');
  const toCustomerId = document.getElementById('tr_child').value;
  const amount = document.getElementById('tr_amount').value;

  if (!toCustomerId) { errorBox.textContent = 'No eligible child to transfer to.'; errorBox.style.display = 'block'; return; }
  if (!amount || Number(amount) <= 0) { errorBox.textContent = 'Enter an amount greater than zero.'; errorBox.style.display = 'block'; return; }
  if (Number(amount) > currentBalance) {
    errorBox.textContent = `Cannot send more than the current balance (₹${formatRupees(currentBalance)}).`;
    errorBox.style.display = 'block';
    return;
  }

  const res = await authedFetch(`/api/wallets/${customerId}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ toCustomerId, amount, notes: document.getElementById('tr_notes').value || undefined }),
  });
  const data = await res.json();
  if (!res.ok) { errorBox.textContent = data.error || 'Could not complete transfer'; errorBox.style.display = 'block'; return; }
  transferModal.style.display = 'none';
  load();
});

load();
