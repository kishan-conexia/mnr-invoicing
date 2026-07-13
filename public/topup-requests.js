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

function formatRupees(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDateTime(d) {
  return new Date(d).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

async function authedFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, cache: 'no-store', headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) { window.location.href = '/login.html'; throw new Error('logged out'); }
  return res;
}

let currentFilter = 'PENDING';

async function loadRequests() {
  const res = await authedFetch(`/api/wallet-topup-requests${currentFilter ? '?status=' + currentFilter : ''}`);
  const requests = await res.json();

  document.getElementById('requestRows').innerHTML = requests.length
    ? requests.map((r) => {
        const name = r.customer.displayName || r.customer.companyName || r.customer.name;
        const actions = r.status === 'PENDING'
          ? `<button class="actionBtn approveBtn" data-id="${r.id}" data-action="approve">Approve</button>
             <button class="actionBtn rejectBtn" data-id="${r.id}" data-action="reject">Reject</button>`
          : `<span style="color:#999; font-size:12px;">${r.reviewedAt ? formatDateTime(r.reviewedAt) : ''}</span>`;
        return `
          <tr>
            <td>${formatDateTime(r.requestedAt)}</td>
            <td>${name}</td>
            <td>${TIER_LABELS[r.customer.tier] || r.customer.tier}</td>
            <td class="num">${formatRupees(r.amount)}</td>
            <td>${r.notes || '—'}</td>
            <td><span class="statusTag ${r.status}">${r.status}</span></td>
            <td>${actions}</td>
          </tr>
        `;
      }).join('')
    : '<tr><td colspan="7" class="empty">No requests here.</td></tr>';

  document.querySelectorAll('.actionBtn').forEach((btn) => {
    btn.addEventListener('click', () => handleAction(btn.dataset.id, btn.dataset.action));
  });
}

async function handleAction(id, action) {
  const res = await authedFetch(`/api/wallet-topup-requests/${id}/${action}`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) {
    alert(data.error || `Could not ${action} this request`);
    return;
  }
  if (action === 'approve') {
    alert(`Approved. ${data.customerName}'s wallet balance is now ${formatRupees(data.newBalance)}.`);
  }
  loadRequests();
}

document.querySelectorAll('.filterTabs button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filterTabs button').forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');
    currentFilter = btn.dataset.status;
    loadRequests();
  });
});

loadRequests();
