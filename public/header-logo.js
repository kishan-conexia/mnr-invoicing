// Included on every logged-in page. Looks for an <img id="companyLogo"> in the
// header and fills it in if the company has uploaded a logo — otherwise leaves
// it hidden so pages look fine before any logo is set.
(function () {
  const token = localStorage.getItem('mnr_token');
  if (!token) return;

  fetch('/api/company', { headers: { Authorization: `Bearer ${token}` } })
    .then((res) => (res.ok ? res.json() : null))
    .then((company) => {
      if (!company || !company.logoUrl) return;
      const img = document.getElementById('companyLogo');
      if (img) {
        img.src = company.logoUrl;
        img.style.display = 'inline-block';
      }
    })
    .catch(() => {});
})();
