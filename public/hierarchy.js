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

function nodeHtml(c, tierLabel) {
  const name = c.displayName || c.companyName || c.name;
  return `
    <div class="node">
      <span class="tierBadge ${c.tier}">${tierLabel}</span>
      <span class="nodeName">${name}</span>
      <span class="nodeCode">${c.customerCode}</span>
    </div>
  `;
}

function renderChildren(parentId, allCustomers) {
  const children = allCustomers.filter((c) => c.parentCustomerId === parentId);
  if (children.length === 0) return '';
  return `<ul>${children.map((c) => `
    <li>
      ${nodeHtml(c, TIER_LABELS[c.tier])}
      ${renderChildren(c.id, allCustomers)}
    </li>
  `).join('')}</ul>`;
}

async function load() {
  const res = await fetch('/api/customers', { headers: { Authorization: `Bearer ${token}` } });
  if (res.status === 401) { window.location.href = '/login.html'; return; }
  const customers = await res.json();

  const topLevel = customers.filter((c) => c.tier === 'DISTRIBUTOR_L1');
  const tree = document.getElementById('tree');

  if (customers.length === 0) {
    tree.innerHTML = '<li class="empty">No customers yet.</li>';
    return;
  }

  const rootHtml = `
    <li>
      <div class="node"><span class="tierBadge ROOT">Company</span><span class="nodeName">MNR Broadband Services</span></div>
      ${topLevel.length
        ? `<ul>${topLevel.map((c) => `<li>${nodeHtml(c, 'Distributor L1')}${renderChildren(c.id, customers)}</li>`).join('')}</ul>`
        : `<ul><li class="empty">No Distributor L1 added yet.</li></ul>`}
    </li>
  `;
  tree.innerHTML = rootHtml;

  // Anything without a valid place in the tree (e.g. a Customer/Partner/L2 whose
  // parent got deleted) still shows up here so nothing silently disappears.
  const placed = new Set();
  (function collect(id) {
    customers.filter((c) => c.parentCustomerId === id).forEach((c) => { placed.add(c.id); collect(c.id); });
  })(null);
  topLevel.forEach((c) => { placed.add(c.id); });
  const orphans = customers.filter((c) => c.tier !== 'DISTRIBUTOR_L1' && !placed.has(c.id));
  if (orphans.length > 0) {
    tree.innerHTML += `
      <li style="margin-top:16px;">
        <div style="font-size:12px; color:#a11e1e; margin-bottom:6px;">⚠ Not yet placed in the hierarchy (parent missing):</div>
        <ul>${orphans.map((c) => `<li>${nodeHtml(c, TIER_LABELS[c.tier])}</li>`).join('')}</ul>
      </li>
    `;
  }
}

load();
