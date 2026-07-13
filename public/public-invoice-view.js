function formatNum(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDateDMY(d) {
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
  const params = new URLSearchParams(window.location.search);
  const token = params.get('token');
  if (!token) { document.getElementById('sheet').textContent = 'No invoice specified.'; return; }

  const res = await fetch(`/api/public/invoices/${token}`);
  if (!res.ok) { document.getElementById('sheet').textContent = 'Invoice not found or the link has expired.'; return; }
  const { invoice: inv, company } = await res.json();

  if (company.logoUrl) {
    const img = document.getElementById('companyLogo');
    img.src = company.logoUrl;
    img.style.display = 'block';
  }
  document.getElementById('companyName').textContent = company.name || 'Invoice';
  document.title = `Invoice ${inv.invoiceNumber || ''} — ${company.name || ''}`;

  const isIntra = inv.taxType === 'CGST_SGST';
  const bank = company.bankDetails || {};

  const itemHeaderCols = isIntra
    ? `<th>#</th><th>Item &amp; Description</th><th class="num">Qty</th><th class="num">Rate</th><th colspan="2">CGST</th><th colspan="2">SGST</th><th class="num">Amount</th>`
    : `<th>#</th><th>Item &amp; Description</th><th class="num">Qty</th><th class="num">Rate</th><th colspan="2">IGST</th><th class="num">Amount</th>`;
  const itemSubHeaderCols = isIntra
    ? `<tr><th></th><th></th><th></th><th></th><th class="num">%</th><th class="num">Amt</th><th class="num">%</th><th class="num">Amt</th><th></th></tr>`
    : `<tr><th></th><th></th><th></th><th></th><th class="num">%</th><th class="num">Amt</th><th></th></tr>`;

  const itemRows = inv.items.map((it, i) => {
    const cells = isIntra
      ? `<td class="num">${Number(it.taxRatePct) / 2}%</td><td class="num">${formatNum(it.cgstAmount)}</td><td class="num">${Number(it.taxRatePct) / 2}%</td><td class="num">${formatNum(it.sgstAmount)}</td>`
      : `<td class="num">${Number(it.taxRatePct)}%</td><td class="num">${formatNum(it.igstAmount)}</td>`;
    return `<tr>
      <td>${i + 1}</td>
      <td>${it.description}</td>
      <td class="num">${Number(it.quantity)}</td>
      <td class="num">${formatNum(it.rate)}</td>
      ${cells}
      <td class="num">${formatNum(it.lineTotal)}</td>
    </tr>`;
  }).join('');

  const taxSummaryRows = isIntra
    ? `<tr><td>CGST</td><td class="num">${formatNum(inv.cgstAmount)}</td></tr>
       <tr><td>SGST</td><td class="num">${formatNum(inv.sgstAmount)}</td></tr>`
    : `<tr><td>IGST</td><td class="num">${formatNum(inv.igstAmount)}</td></tr>`;

  const c = inv.customer;

  document.getElementById('sheet').innerHTML = `
    <div class="letterhead">
      <div>
        ${company.logoUrl ? `<img src="${company.logoUrl}" alt="${company.name}" style="height:48px; width:auto; margin-bottom:8px; display:block;">` : ''}
        <div class="companyName">${company.name}</div>
        <div class="companyAddr">
          ${companyAddressLine(company)}<br>
          ${company.gstin ? 'GSTIN: ' + company.gstin + '<br>' : ''}
          ${company.contactEmail ? company.contactEmail + (company.contactPhone ? ' · ' + company.contactPhone : '') : ''}
        </div>
      </div>
      <div class="docTitle">TAX INVOICE<span class="badge">${inv.status.replace('_', ' ')}</span></div>
    </div>

    <div class="metaGrid">
      <div class="col">
        <table>
          <tr><td class="k">Invoice #</td><td>: ${inv.invoiceNumber || '—'}</td></tr>
          <tr><td class="k">Invoice Date</td><td>: ${formatDateDMY(inv.invoiceDate)}</td></tr>
          <tr><td class="k">Due Date</td><td>: ${formatDateDMY(inv.dueDate)}</td></tr>
        </table>
      </div>
      <div class="col">
        <table>
          <tr><td class="k">Place Of Supply</td><td>: ${inv.placeOfSupplyState}</td></tr>
        </table>
      </div>
    </div>

    <div class="partiesGrid">
      <div class="col">
        <div class="label">Invoiced To</div>
        <div class="name">${c.displayName || c.companyName || c.name}</div>
        ${(c.displayName || c.companyName) && c.name !== (c.displayName || c.companyName) ? `Attn: ${c.name}<br>` : ''}
        ${c.gstin ? 'GSTIN ' + c.gstin : ''}
      </div>
      <div class="col">
        <div class="label">Shipped To</div>
        <div class="name">${c.displayName || c.companyName || c.name}</div>
      </div>
    </div>

    <table class="items">
      <thead>
        <tr>${itemHeaderCols}</tr>
        ${itemSubHeaderCols}
      </thead>
      <tbody>${itemRows}</tbody>
    </table>

    <div class="bottomGrid">
      <div class="left">
        <div class="wordsBox">
          <b>Items in Total ${inv.items.length}</b>
        </div>
        <div class="wordsBox">
          <b>Total In Words</b>
          <i>${amountInWords(inv.totalValue)}</i>
        </div>
      </div>
      <div class="right">
        <table>
          <tr><td>Sub Total</td><td class="num">${formatNum(inv.subtotal)}</td></tr>
          ${taxSummaryRows}
          ${Number(inv.roundOff) !== 0 ? `<tr><td>Round Off</td><td class="num">${formatNum(inv.roundOff)}</td></tr>` : ''}
          <tr class="total"><td>Total</td><td class="num">${formatNum(inv.totalValue)}</td></tr>
        </table>
      </div>
    </div>

    <div class="footerBlock">
      ${bank.accountName ? `
      <h4>Payment via wire transfer or cheque</h4>
      Beneficiary: ${bank.accountName}<br>
      Bank: ${bank.bankName || ''}<br>
      Account Number: ${bank.accountNumber || ''}<br>
      IFSC Code: ${bank.ifsc || ''}
      ` : ''}

      ${company.termsAndConditions ? `
      <h4>Terms &amp; Conditions</h4>
      ${company.termsAndConditions}
      ` : ''}
    </div>
  `;

  if (params.get('download') === '1') {
    setTimeout(() => window.print(), 300);
  }
}

load();
