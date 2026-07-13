const token = localStorage.getItem('mnr_token');
const user = JSON.parse(localStorage.getItem('mnr_user') || 'null');
if (!token || !user) window.location.href = '/login.html';

document.getElementById('whoAmI').textContent = `${user.name} (${user.role})`;
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('mnr_token');
  localStorage.removeItem('mnr_user');
  window.location.href = '/login.html';
});

function formatRupees(n) {
  return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

let allPayments = [];

async function loadPayments() {
  const res = await fetch('/api/payments', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  allPayments = await res.json();
  renderPaymentRows(allPayments);
}

function renderPaymentRows(list) {
  const rows = list.map((p) => {
    const allocatedTo = p.allocations.length
      ? p.allocations.map((a) => a.invoice.invoiceNumber).join(', ')
      : '<span style="color:#999">Unallocated</span>';
    return `
      <tr class="clickable" onclick="window.location.href='/receipt-view.html?id=${p.id}'">
        <td>${p.receipt ? p.receipt.receiptNumber : '—'}</td>
        <td>${p.customer.displayName || p.customer.companyName || p.customer.name}</td>
        <td>${formatDate(p.paymentDate)}</td>
        <td>${formatRupees(p.amount)}</td>
        <td>${p.mode.replace('_', ' ')}</td>
        <td>${allocatedTo}</td>
      </tr>
    `;
  }).join('');
  document.getElementById('paymentRows').innerHTML = rows || '<tr><td colspan="6">No matching payments.</td></tr>';
}

document.getElementById('searchInput').addEventListener('input', (e) => {
  const q = e.target.value.trim().toLowerCase();
  if (!q) { renderPaymentRows(allPayments); return; }
  const filtered = allPayments.filter((p) => [
    p.receipt?.receiptNumber, p.customer.displayName, p.customer.companyName, p.customer.name, p.mode,
    ...p.allocations.map((a) => a.invoice.invoiceNumber),
  ].filter(Boolean).join(' ').toLowerCase().includes(q));
  renderPaymentRows(filtered);
});

loadPayments();
