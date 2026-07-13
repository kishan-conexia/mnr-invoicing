(function () {
  const token = localStorage.getItem('mnr_portal_token');
  const customer = JSON.parse(localStorage.getItem('mnr_portal_customer') || 'null');
  if (!token || !customer) { window.location.href = '/portal-login.html'; return; }

  const TABS = [
    { href: '/portal-home.html', label: 'Dashboard' },
    { href: '/portal-customers.html', label: 'Customers' },
    { href: '/portal-invoices.html', label: 'Invoices' },
    { href: '/portal-wallet.html', label: 'Wallet' },
  ];
  const path = window.location.pathname.split('/').pop() || 'portal-home.html';

  const navHtml = TABS.map((t) => `<a href="${t.href}" class="${t.href.endsWith(path) ? 'active' : ''}">${t.label}</a>`).join('');

  document.body.insertAdjacentHTML('afterbegin', `
    <header>
      <div class="brand">
        <img id="companyLogo" alt="logo">
        <div>
          <h1>MNR Broadband — Partner Portal</h1>
          <nav class="portalNav">${navHtml}</nav>
        </div>
      </div>
      <div>
        <span class="who" id="whoAmI"></span>
        <button id="logoutBtn">Log out</button>
      </div>
    </header>
  `);

  document.getElementById('whoAmI').textContent = customer.name;
  document.getElementById('logoutBtn').addEventListener('click', () => {
    localStorage.removeItem('mnr_portal_token');
    localStorage.removeItem('mnr_portal_customer');
    window.location.href = '/portal-login.html';
  });

  fetch('/api/company/public')
    .then((res) => (res.ok ? res.json() : null))
    .then((company) => {
      if (!company || !company.logoUrl) return;
      const img = document.getElementById('companyLogo');
      img.src = company.logoUrl;
      img.style.display = 'block';
    })
    .catch(() => {});
})();
