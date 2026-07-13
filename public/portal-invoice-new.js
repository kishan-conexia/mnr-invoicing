const token = localStorage.getItem('mnr_portal_token');
const customer = JSON.parse(localStorage.getItem('mnr_portal_customer') || 'null');
if (!token || !customer) window.location.href = '/portal-login.html';

document.getElementById('whoAmI').textContent = customer.name;
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('mnr_portal_token');
  localStorage.removeItem('mnr_portal_customer');
  window.location.href = '/portal-login.html';
});

async function portalFetch(url, opts = {}) {
  const res = await fetch(url, { ...opts, cache: 'no-store', headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}`, ...(opts.body ? { 'Content-Type': 'application/json' } : {}) } });
  if (res.status === 401) { window.location.href = '/portal-login.html'; throw new Error('logged out'); }
  return res;
}

fetch('/api/company/public').then((r) => r.ok ? r.json() : null).then((c) => {
  if (c && c.logoUrl) { const img = document.getElementById('companyLogo'); img.src = c.logoUrl; img.style.display = 'block'; }
}).catch(() => {});

let downline = [];
let products = [];
let companyGstin = '';

function todayStr() { return new Date().toISOString().slice(0, 10); }
function plusDays(days) { const d = new Date(); d.setDate(d.getDate() + days); return d.toISOString().slice(0, 10); }

function formatRupees(n) { return '₹' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function isIntraState() {
  const target = downline.find((c) => c.id === document.getElementById('f_customer').value);
  if (!target || !companyGstin) return true;
  return target.stateCode === companyGstin.slice(0, 2);
}

function recalculate() {
  const rows = [...document.querySelectorAll('#itemsBody tr')];
  const intra = isIntraState();
  let subtotal = 0, taxable = 0, cgst = 0, sgst = 0, igst = 0;

  rows.forEach((row) => {
    const qty = Number(row.querySelector('.line-qty').value) || 0;
    const rate = Number(row.querySelector('.line-rate').value) || 0;
    const discountPct = Number(row.querySelector('.line-discount').value) || 0;
    const taxPct = Number(row.querySelector('.line-tax').value) || 0;

    const gross = qty * rate;
    const taxableValue = gross - (gross * discountPct) / 100;
    const taxAmount = (taxableValue * taxPct) / 100;
    row.querySelector('.line-total').textContent = formatRupees(taxableValue + taxAmount);

    subtotal += gross;
    taxable += taxableValue;
    if (intra) { cgst += taxAmount / 2; sgst += taxAmount / 2; } else { igst += taxAmount; }
  });

  document.getElementById('s_subtotal').textContent = formatRupees(subtotal);
  document.getElementById('s_taxable').textContent = formatRupees(taxable);
  document.getElementById('s_cgst').textContent = formatRupees(cgst);
  document.getElementById('s_sgst').textContent = formatRupees(sgst);
  document.getElementById('s_igst').textContent = formatRupees(igst);
  document.getElementById('s_cgstRow').style.display = intra ? 'flex' : 'none';
  document.getElementById('s_sgstRow').style.display = intra ? 'flex' : 'none';
  document.getElementById('s_igstRow').style.display = intra ? 'none' : 'flex';
  document.getElementById('s_total').textContent = formatRupees(Math.round(taxable + cgst + sgst + igst));
}

function addLine() {
  const tbody = document.getElementById('itemsBody');
  const row = document.createElement('tr');
  const options = products.map((p) => `<option value="${p.id}" data-rate="${p.standardRate}" data-tax="${p.taxRate ? p.taxRate.ratePct : 0}">${p.name}</option>`).join('');
  row.innerHTML = `
    <td>
      <select class="line-product">
        <option value="">— Custom line —</option>
        ${options}
      </select>
    </td>
    <td><input class="line-qty" type="number" value="1" min="0" step="0.01"></td>
    <td><input class="line-rate" type="number" value="0" min="0" step="0.01"></td>
    <td><input class="line-discount" type="number" value="0" min="0" max="100" step="0.01"></td>
    <td><input class="line-tax" type="number" value="18" min="0" max="100" step="0.01"></td>
    <td class="num line-total">₹0.00</td>
    <td><button class="removeBtn">✕</button></td>
  `;
  tbody.appendChild(row);

  row.querySelector('.line-product').addEventListener('change', (e) => {
    const opt = e.target.selectedOptions[0];
    if (opt.value) {
      row.querySelector('.line-rate').value = opt.dataset.rate;
      row.querySelector('.line-tax').value = opt.dataset.tax;
    }
    recalculate();
  });
  row.querySelectorAll('.line-qty, .line-rate, .line-discount, .line-tax').forEach((el) => el.addEventListener('input', recalculate));
  row.querySelector('.removeBtn').addEventListener('click', () => { row.remove(); recalculate(); });

  recalculate();
}

document.getElementById('addLineBtn').addEventListener('click', addLine);
document.getElementById('f_customer').addEventListener('change', recalculate);

document.getElementById('saveBtn').addEventListener('click', async () => {
  const errorBox = document.getElementById('errorBox');
  errorBox.style.display = 'none';

  const rows = [...document.querySelectorAll('#itemsBody tr')];
  const items = rows.map((row) => {
    const productSelect = row.querySelector('.line-product');
    const selectedOpt = productSelect.selectedOptions[0];
    return {
      productServiceId: productSelect.value || undefined,
      description: selectedOpt && selectedOpt.value ? selectedOpt.textContent : 'Custom line item',
      quantity: row.querySelector('.line-qty').value,
      rate: row.querySelector('.line-rate').value,
      discountPct: row.querySelector('.line-discount').value,
      taxRatePct: row.querySelector('.line-tax').value,
    };
  });

  const body = {
    customerId: document.getElementById('f_customer').value,
    invoiceDate: document.getElementById('f_invoiceDate').value,
    dueDate: document.getElementById('f_dueDate').value,
    items,
  };

  if (!body.customerId || items.length === 0) {
    errorBox.textContent = 'Pick who you\'re billing and add at least one line item.';
    errorBox.style.display = 'block';
    return;
  }

  const res = await portalFetch('/api/portal/invoices', { method: 'POST', body: JSON.stringify(body) });
  const data = await res.json();
  if (!res.ok) { errorBox.textContent = data.error || 'Could not save invoice'; errorBox.style.display = 'block'; return; }

  window.location.href = '/portal-invoices.html';
});

async function init() {
  // Gate: bottom-tier Customers have no downline to bill at all, and everyone
  // needs a positive wallet balance before they're allowed to issue invoices.
  if (customer.tier === 'CUSTOMER') {
    document.getElementById('gateBlock').style.display = 'block';
    document.getElementById('gateBlock').textContent = 'Only distributors and partners can create invoices for their downline.';
    return;
  }

  const walletRes = await portalFetch('/api/portal/wallet');
  const wallet = await walletRes.json();
  if (Number(wallet.balance) <= 0) {
    document.getElementById('gateBlock').style.display = 'block';
    document.getElementById('gateBlock').textContent = 'You need a positive wallet balance before you can create an invoice. Request a top-up from the Wallet tab first.';
    return;
  }

  const [downlineRes, productsRes, companyRes] = await Promise.all([
    portalFetch('/api/portal/downline'),
    portalFetch('/api/portal/products'),
    portalFetch('/api/portal/company'),
  ]);
  downline = await downlineRes.json();
  products = await productsRes.json();
  const company = await companyRes.json();
  companyGstin = company.gstin || '';

  if (downline.length === 0) {
    document.getElementById('gateBlock').style.display = 'block';
    document.getElementById('gateBlock').textContent = 'You have nobody in your downline yet, so there\'s nobody to bill.';
    return;
  }

  document.getElementById('formArea').style.display = 'block';
  document.getElementById('f_invoiceDate').value = todayStr();
  document.getElementById('f_dueDate').value = plusDays(15);
  document.getElementById('f_customer').innerHTML = downline.map((c) => `<option value="${c.id}">${c.displayName}</option>`).join('');
  addLine();
}

init();
