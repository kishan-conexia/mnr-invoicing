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
const TIER_ORDER = { DISTRIBUTOR_L1: 0, DISTRIBUTOR_L2: 1, PARTNER: 2, CUSTOMER: 3 };

function formatRupees(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

let allWallets = [];

async function load() {
  const res = await fetch('/api/wallets', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  allWallets = await res.json();
  allWallets.sort((a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier]);
  renderWalletRows(allWallets);
}

function renderWalletRows(list) {
  document.getElementById('walletRows').innerHTML = list.length
    ? list.map((w) => `
        <tr class="clickable" onclick="window.location.href='/wallet-view.html?customerId=${w.customerId}'">
          <td>${w.customerCode}</td>
          <td>${w.displayName}</td>
          <td><span class="tierBadge ${w.tier}">${TIER_LABELS[w.tier]}</span></td>
          <td class="num ${Number(w.balance) < 0 ? 'negative' : ''}">₹${formatRupees(w.balance)}</td>
        </tr>
      `).join('')
    : '<tr><td colspan="4">No matching wallets.</td></tr>';
}

document.getElementById('searchInput').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) { renderWalletRows(allWallets); return; }
  const filtered = allWallets.filter((w) => [w.customerCode, w.displayName, TIER_LABELS[w.tier]]
    .filter(Boolean).join(' ').toLowerCase().includes(q));
  renderWalletRows(filtered);
});

load();
