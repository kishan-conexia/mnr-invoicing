(function () {
  const token = localStorage.getItem('mnr_token');
  if (!token) return; // login page etc — no shell without a session

  const user = JSON.parse(localStorage.getItem('mnr_user') || 'null');

  const NAV_ITEMS = [
    { href: '/home.html', label: 'Dashboard', icon: '\u25A6' },
    { href: '/dashboard.html', label: 'Customers', icon: '\u25F1' },
    { href: '/products.html', label: 'Products & Services', icon: '\u25A4' },
    { href: '/invoices.html', label: 'Invoices', icon: '\u25A5', matchAlso: ['invoice-new.html', 'invoice-view.html'] },
    { href: '/payments.html', label: 'Payments', icon: '\u20B9', matchAlso: ['payment-new.html', 'receipt-view.html'] },
    { href: '/wallets.html', label: 'Wallets', icon: '\u25CE', matchAlso: ['wallet-view.html'] },
    { href: '/topup-requests.html', label: 'Top-up Requests', icon: '\u2191' },
    { href: '/hierarchy.html', label: 'Hierarchy', icon: '\u2687' },
    { href: '/settings.html', label: 'Settings', icon: '\u2699' },
  ];

  const path = window.location.pathname.split('/').pop() || 'home.html';
  function isActive(item) {
    if (item.href.endsWith(path)) return true;
    if (item.matchAlso && item.matchAlso.includes(path)) return true;
    return false;
  }

  const navHtml = NAV_ITEMS.map((item) => `
    <a href="${item.href}" class="${isActive(item) ? 'active' : ''}">
      <span class="navIcon">${item.icon}</span>${item.label}
    </a>
  `).join('');

  const activeItem = NAV_ITEMS.find(isActive);
  const pageTitle = activeItem ? activeItem.label : 'Dashboard';

  const initials = user && user.name
    ? user.name.split(' ').filter(Boolean).map((w) => w[0]).slice(0, 2).join('').toUpperCase()
    : '?';

  const shellHtml = `
    <div class="appSidebar">
      <div class="brand">
        <img id="companyLogo" alt="logo">
        <div class="brandText">
          <div class="brandName" id="sidebarBrandName">MNR Broadband</div>
          <div class="brandSub">Invoicing</div>
        </div>
      </div>
      <div class="navSectionLabel">Menu</div>
      <nav>${navHtml}</nav>
    </div>
    <div class="appTopbar">
      <div class="breadcrumb">MNR Broadband Services <span class="sep">/</span> <b>${pageTitle}</b></div>
      <div class="searchDecoy"><span>Search this page…</span><kbd>filter</kbd></div>
      <div class="rightGroup">
        <span class="statusPill"><span class="dot"></span>All OK</span>
        <span class="who" id="whoAmI"></span>
        <div class="avatar">${initials}</div>
        <button id="logoutBtn">Log out</button>
      </div>
    </div>
  `;

  document.body.classList.add('has-shell');
  document.body.insertAdjacentHTML('afterbegin', shellHtml);

  // The search box here is a visual placeholder that hands off to whatever
  // real search box already exists on the page (Customers, Invoices, etc.)
  // rather than duplicating filtering logic.
  const decoy = document.querySelector('.searchDecoy');
  decoy.addEventListener('click', () => {
    const real = document.getElementById('searchInput');
    if (real) real.focus();
  });

  fetch('/api/company', { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => (res.ok ? res.json() : null))
    .then((company) => {
      if (!company) return;
      if (company.logoUrl) {
        const img = document.getElementById('companyLogo');
        img.src = company.logoUrl;
        img.style.display = 'block';
      }
      if (company.name) {
        document.getElementById('sidebarBrandName').textContent = company.name;
      }
    })
    .catch(() => {});
})();
