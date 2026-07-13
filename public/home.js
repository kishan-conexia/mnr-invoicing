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
  return '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 0 });
}
function formatDate(d) {
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

async function load() {
  const res = await fetch('/api/dashboard', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  const d = await res.json();

  document.getElementById('kpiGrid').innerHTML = `
    <div class="kpiCard"><div class="label">Total Sales</div><div class="value">${formatRupees(d.totalSales)}</div></div>
    <div class="kpiCard received"><div class="label">Amount Received</div><div class="value">${formatRupees(d.amountReceived)}</div></div>
    <div class="kpiCard"><div class="label">Outstanding</div><div class="value">${formatRupees(d.outstandingAmount)}</div></div>
    <div class="kpiCard overdue"><div class="label">Overdue (${d.overdueInvoiceCount})</div><div class="value">${formatRupees(d.overdueAmount)}</div></div>
    <div class="kpiCard"><div class="label">GST Collected</div><div class="value">${formatRupees(d.gstCollected)}</div></div>
  `;

  const maxRevenue = Math.max(...d.monthlyRevenue.map((m) => m.amount), 1);
  document.getElementById('revenueChart').innerHTML = d.monthlyRevenue.map((m) => `
    <div class="bar">
      <div class="barValue">${m.amount > 0 ? formatRupees(m.amount) : ''}</div>
      <div class="barFill" style="height:${Math.max((m.amount / maxRevenue) * 100, 2)}%"></div>
      <div class="barLabel">${m.month}</div>
    </div>
  `).join('');

  document.getElementById('topOutstandingRows').innerHTML = d.topOutstandingCustomers.length
    ? d.topOutstandingCustomers.map((c) => `<tr><td>${c.name}</td><td class="num">${formatRupees(c.outstanding)}</td></tr>`).join('')
    : '<tr><td class="empty">No outstanding balances — everything is settled.</td></tr>';

  document.getElementById('recentInvoicesRows').innerHTML = d.recentInvoices.length
    ? d.recentInvoices.map((inv) => `
        <tr class="clickable" onclick="window.location.href='/invoice-view.html?id=${inv.id}'">
          <td>${inv.invoiceNumber || '(draft)'}</td>
          <td>${inv.customer.displayName || inv.customer.companyName || inv.customer.name}</td>
          <td class="num">${formatRupees(inv.totalValue)}</td>
          <td><span class="badge ${inv.status}">${inv.status.replace('_', ' ')}</span></td>
        </tr>
      `).join('')
    : '<tr><td class="empty" colspan="4">No invoices yet.</td></tr>';

  document.getElementById('recentPaymentsRows').innerHTML = d.recentPayments.length
    ? d.recentPayments.map((p) => `
        <tr class="clickable" onclick="window.location.href='/receipt-view.html?id=${p.id}'">
          <td>${p.customer.displayName || p.customer.companyName || p.customer.name}</td>
          <td class="num">${formatRupees(p.amount)}</td>
          <td>${p.mode.replace('_', ' ')}</td>
        </tr>
      `).join('')
    : '<tr><td class="empty" colspan="3">No payments recorded yet.</td></tr>';
}

load();
