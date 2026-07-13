fetch('/api/company/public')
  .then((res) => (res.ok ? res.json() : null))
  .then((company) => {
    if (!company || !company.logoUrl) return;
    const img = document.getElementById('loginLogo');
    img.src = company.logoUrl;
    img.style.display = 'block';
  })
  .catch(() => {});

document.getElementById('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const email = document.getElementById('email').value;
  const password = document.getElementById('password').value;
  const errorBox = document.getElementById('error');
  errorBox.style.display = 'none';

  try {
    const res = await fetch('/api/portal/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const data = await res.json();

    if (!res.ok) {
      errorBox.textContent = data.error || 'Login failed';
      errorBox.style.display = 'block';
      return;
    }

    localStorage.setItem('mnr_portal_token', data.token);
    localStorage.setItem('mnr_portal_customer', JSON.stringify(data.customer));
    window.location.href = '/portal-home.html';
  } catch (err) {
    errorBox.textContent = 'Could not reach the server. Is it running?';
    errorBox.style.display = 'block';
  }
});
