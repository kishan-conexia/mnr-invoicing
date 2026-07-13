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
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
function twoDigitWords(n) { if (n < 20) return ONES[n]; const t = Math.floor(n / 10), o = n % 10; return TENS[t] + (o ? '-' + ONES[o] : ''); }
function threeDigitWords(n) { const h = Math.floor(n / 100), r = n % 100; let out = ''; if (h) out += ONES[h] + ' Hundred' + (r ? ' ' : ''); if (r) out += twoDigitWords(r); return out; }
function numberToIndianWords(num) {
  num = Math.floor(num);
  if (num === 0) return 'Zero';
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const hundred = num;
  let parts = [];
  if (crore) parts.push(threeDigitWords(crore) + ' Crore');
  if (lakh) parts.push(threeDigitWords(lakh) + ' Lakh');
  if (thousand) parts.push(threeDigitWords(thousand) + ' Thousand');
  if (hundred) parts.push(threeDigitWords(hundred));
  return parts.join(' ');
}
function amountInWords(amount) {
  const rupees = Math.floor(amount);
  const paise = Math.round((amount - rupees) * 100);
  let words = `Rupees ${numberToIndianWords(rupees)}`;
  if (paise > 0) words += ` and ${numberToIndianWords(paise)} Paise`;
  return words + ' Only';
}

function companyAddressLine(company) {
  const cityStatePin = [company.city, company.state, company.pincode].filter(Boolean).join(' ');
  return [company.registeredAddress, cityStatePin, company.country].filter(Boolean).join('<br>');
}

async function load() {
  const id = new URLSearchParams(window.location.search).get('id');
  if (!id) { document.getElementById('sheet').textContent = 'No payment specified.'; return; }

  const [payRes, companyRes] = await Promise.all([
    fetch(`/api/payments/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch('/api/company', { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  if (payRes.status === 401) { window.location.href = '/login.html'; return; }
  if (!payRes.ok) { document.getElementById('sheet').textContent = 'Payment not found.'; return; }

  const payment = await payRes.json();
  const company = await companyRes.json();
  const c = payment.customer;

  const allocRows = payment.allocations.length
    ? payment.allocations.map((a) => `
        <tr>
          <td>${a.invoice.invoiceNumber}</td>
          <td>${formatDate(a.invoice.invoiceDate)}</td>
          <td class="num">₹${formatRupees(a.invoice.totalValue)}</td>
          <td class="num">₹${formatRupees(a.amount)}</td>
        </tr>`).join('')
    : `<tr><td colspan="4" style="color:#999">Not allocated to any invoice — recorded as an advance / unallocated payment.</td></tr>`;

  document.getElementById('sheet').innerHTML = `
    <div class="letterhead">
      <div>
        ${company.logoUrl ? `<img src="${company.logoUrl}" alt="${company.name}" style="height:48px; width:auto; margin-bottom:8px; display:block;">` : ''}
        <div class="companyName">${company.name}</div>
        <div class="companyAddr">
          ${companyAddressLine(company)}<br>
          ${company.gstin ? 'GSTIN: ' + company.gstin : ''}
        </div>
      </div>
      <div class="docTitle">PAYMENT RECEIPT</div>
    </div>

    <div class="metaRow">
      <div>
        Receipt #: ${payment.receipt ? payment.receipt.receiptNumber : '—'}<br>
        Payment date: ${formatDate(payment.paymentDate)}<br>
        Mode: ${payment.mode.replace('_', ' ')}${payment.referenceNumber ? ' · Ref: ' + payment.referenceNumber : ''}
      </div>
      <div style="text-align:right">
        Received from<br>
        <strong>${c.companyName || c.name}</strong><br>
        ${c.gstin ? 'GSTIN: ' + c.gstin : ''}
      </div>
    </div>

    <table>
      <thead><tr><th>Invoice #</th><th>Invoice date</th><th class="num">Invoice total</th><th class="num">Amount allocated</th></tr></thead>
      <tbody>${allocRows}</tbody>
    </table>

    <div class="summary">
      <div><span>Amount received</span><span>₹${formatRupees(payment.amount)}</span></div>
      ${Number(payment.tdsDeducted) > 0 ? `<div><span>TDS deducted</span><span>₹${formatRupees(payment.tdsDeducted)}</span></div>` : ''}
      ${Number(payment.bankCharges) > 0 ? `<div><span>Bank charges</span><span>₹${formatRupees(payment.bankCharges)}</span></div>` : ''}
      ${Number(payment.unallocatedAmount) > 0 ? `<div><span>Unallocated balance</span><span>₹${formatRupees(payment.unallocatedAmount)}</span></div>` : ''}
      <div class="total"><span>Total received</span><span>₹${formatRupees(payment.amount)}</span></div>
    </div>

    <div class="wordsBox">
      <b>Amount in words</b>
      <i>${amountInWords(payment.amount)}</i>
    </div>

    ${payment.notes ? `<div style="font-size:12px; color:#555;">Notes: ${payment.notes}</div>` : ''}
  `;
}

load();
