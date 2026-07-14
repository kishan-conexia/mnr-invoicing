const token = localStorage.getItem('mnr_token');
const user = JSON.parse(localStorage.getItem('mnr_user') || 'null');
if (!token || !user) window.location.href = '/login.html';

document.getElementById('whoAmI').textContent = `${user.name} (${user.role})`;
document.getElementById('logoutBtn').addEventListener('click', () => {
  localStorage.removeItem('mnr_token');
  localStorage.removeItem('mnr_user');
  window.location.href = '/login.html';
});

function formatNum(n) {
  return Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function formatDate(d) {
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' }).replace(/\//g, '/');
}

// ── Indian-style amount-in-words (Lakh/Crore, with Paise) ──
const ONES = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function twoDigitWords(n) {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10), ones = n % 10;
  return TENS[tens] + (ones ? '-' + ONES[ones] : '');
}
function threeDigitWords(n) {
  const hundred = Math.floor(n / 100), rest = n % 100;
  let out = '';
  if (hundred) out += ONES[hundred] + ' Hundred' + (rest ? ' ' : '');
  if (rest) out += twoDigitWords(rest);
  return out;
}
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

function addressBlock(customer, type) {
  const addr = (customer.addresses || []).find((a) => a.type === type);
  const fallback = type === 'INSTALLATION' ? (customer.addresses || []).find((a) => a.type === 'BILLING') : null;
  const use = addr || fallback;
  if (!use) return customer.state ? customer.state : '';
  const lines = [use.line1];
  lines.push([use.city, use.state, use.pincode].filter(Boolean).join(' '));
  return lines.filter(Boolean).join('<br>') + (!addr && fallback ? '<br><span style="color:#999">(same as billing)</span>' : '');
}

async function load() {
  const params = new URLSearchParams(window.location.search);
  const id = params.get('id');
  if (!id) { document.getElementById('sheet').textContent = 'No invoice specified.'; return; }

  const [invRes, companyRes] = await Promise.all([
    fetch(`/api/invoices/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
    fetch('/api/company', { headers: { Authorization: `Bearer ${token}` } }),
  ]);
  if (invRes.status === 401) { window.location.href = '/login.html'; return; }
  if (!invRes.ok) { document.getElementById('sheet').textContent = 'Invoice not found.'; return; }

  const inv = await invRes.json();
  const company = await companyRes.json();
  const isIntra = inv.taxType === 'CGST_SGST';
  const bank = company.bankDetails || {};

  // Load e-invoice status (IRN, QR Code, etc.)
  let einv = { eInvoiceStatus: inv.eInvoiceStatus || 'NOT_APPLICABLE', irn: null, irnAckNumber: null, irnAckDate: null, eInvoiceQrCode: null };
  try {
    const einvRes = await fetch(`/api/invoices/${id}/einvoice-status`, { headers: { Authorization: `Bearer ${token}` } });
    if (einvRes.ok) einv = await einvRes.json();
  } catch (e) { /* silent fail - non-critical */ }

  document.getElementById('mailBtn').addEventListener('click', async () => {
    const email = prompt(`Send invoice ${inv.invoiceNumber} to which email address?`, '');
    if (!email) return;
    const res = await fetch(`/api/invoices/${id}/send-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ toEmail: email }),
    });
    const data = await res.json();
    alert(res.ok ? `Sent to ${email}.` : (data.error || 'Could not send email'));
  });

  document.getElementById('whatsappBtn').addEventListener('click', async () => {
    const res = await fetch(`/api/invoices/${id}/share-link`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    if (!res.ok) { alert(data.error || 'Could not create share link'); return; }
    const message = `Invoice ${inv.invoiceNumber} for ₹${formatNum(inv.totalValue)}. View it here: ${data.url}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
  });

  // Generate IRN button (only shown when e-invoicing is enabled and IRN is pending/failed)
  const irnBtn = document.getElementById('irnBtn');
  if (irnBtn) {
    if (einv.eInvoiceStatus === 'PENDING' || einv.eInvoiceStatus === 'FAILED') {
      irnBtn.style.display = 'inline-block';
      irnBtn.addEventListener('click', async () => {
        if (!confirm('Generate IRN from the Government IRP for this invoice?')) return;
        irnBtn.disabled = true;
        irnBtn.textContent = 'Generating...';
        const res = await fetch(`/api/invoices/${id}/generate-irn`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (res.ok) {
          alert(`IRN generated successfully!\nIRN: ${data.irn}\nAck No: ${data.ackNumber}`);
          window.location.reload();
        } else {
          alert(`Failed: ${data.error}`);
          irnBtn.disabled = false;
          irnBtn.textContent = 'Generate IRN';
        }
      });
    } else {
      irnBtn.style.display = 'none';
    }
  }

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
          <tr><td class="k">Invoice Date</td><td>: ${formatDate(inv.invoiceDate)}</td></tr>
          <tr><td class="k">Terms</td><td>: ${c.paymentTermsDays ? 'Net ' + c.paymentTermsDays + ' days' : 'Due on Receipt'}</td></tr>
          <tr><td class="k">Due Date</td><td>: ${formatDate(inv.dueDate)}</td></tr>
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
        ${addressBlock(c, 'BILLING')}
        ${c.gstin ? '<br><br>GSTIN ' + c.gstin : ''}
      </div>
      <div class="col">
        <div class="label">Shipped To</div>
        <div class="name">${c.displayName || c.companyName || c.name}</div>
        ${addressBlock(c, 'INSTALLATION')}
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
      <h4>Notes</h4>
      ${company.name} taxation details ${company.pan ? '— PAN: ' + company.pan : ''} ${company.gstin ? 'GSTIN: ' + company.gstin : ''}

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

    <!-- E-Invoicing block: IRN, Ack, QR code -->
    ${buildIrnBlock(einv)}
  `;

  if (einv.eInvoiceQrCode && !einv.eInvoiceQrCode.startsWith('iVBORw')) {
    setTimeout(() => {
      const canvas = document.getElementById('qrCanvas');
      if (canvas && typeof QRCode !== 'undefined') {
        QRCode.toCanvas(canvas, einv.eInvoiceQrCode, { width: 80, margin: 1 }, function (error) {
          if (error) console.error('QR Code error:', error);
        });
      }
    }, 50);
  }

  // Cancel IRN button handler
  const cancelIrnBtn = document.getElementById('cancelIrnBtn');
  if (cancelIrnBtn) {
    cancelIrnBtn.addEventListener('click', async () => {
      const reasons = ['1 — Duplicate', '2 — Data Entry Mistake', '3 — Order Cancelled', '4 — Other'];
      const chosen = prompt(`Select cancel reason (enter number 1-4):\n${reasons.join('\n')}`);
      const code = parseInt(chosen);
      if (!code || code < 1 || code > 4) { alert('Invalid reason code. Enter 1, 2, 3, or 4.'); return; }
      const reasonText = prompt('Briefly describe the reason for cancellation:');
      if (!reasonText) return;
      if (!confirm('Cancel this IRN at the Government IRP? This cannot be undone.')) return;
      const res = await fetch(`/api/invoices/${id}/cancel-irn`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ cancelReasonCode: code, cancelReason: reasonText }),
      });
      const data = await res.json();
      alert(res.ok ? 'IRN cancelled at IRP.' : (data.error || 'Cancellation failed'));
      if (res.ok) window.location.reload();
    });
  }

  if (params.get('download') === '1') {
    setTimeout(() => window.print(), 300);
  }
}

load();

// ── E-Invoice block builder ─────────────────────────────────────────────
// Renders the IRN / QR Code section at the bottom of the invoice.
// Mandatory on printed invoices when e-invoicing is active per GSTN rules.
function buildIrnBlock(einv) {
  const status = einv.eInvoiceStatus || 'NOT_APPLICABLE';
  if (status === 'NOT_APPLICABLE') return '';

  const statusColors = { PENDING: '#fff4d6', GENERATED: '#e6f4ea', CANCELLED: '#fce8e6', FAILED: '#fce8e6' };
  const statusLabels = { PENDING: 'Pending IRN Generation', GENERATED: 'IRN Generated ✓', CANCELLED: 'IRN Cancelled', FAILED: 'IRN Generation Failed' };

  const bgColor = statusColors[status] || '#f5f5f5';
  const label = statusLabels[status] || status;

  let qrHtml = '';
  if (einv.eInvoiceQrCode) {
    if (einv.eInvoiceQrCode.startsWith('iVBORw')) {
      qrHtml = `<img src="data:image/png;base64,${einv.eInvoiceQrCode}" alt="E-Invoice QR Code" style="width:80px;height:80px;flex-shrink:0;">`;
    } else {
      qrHtml = `<canvas id="qrCanvas" style="width:80px;height:80px;flex-shrink:0;"></canvas>`;
    }
  } else {
    qrHtml = `<div style="width:80px;height:80px;border:1px dashed #bbb;display:flex;align-items:center;justify-content:center;font-size:9px;color:#aaa;text-align:center;flex-shrink:0;">QR Code</div>`;
  }

  const cancelBtn = (status === 'GENERATED')
    ? `<button id="cancelIrnBtn" style="margin-top:8px;background:none;border:1px solid #c62828;color:#c62828;border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;">Cancel IRN</button>`
    : '';

  const irnLine = einv.irn ? `<div style="font-family:monospace;font-size:10px;word-break:break-all;color:#333;margin-top:2px;">${einv.irn}</div>` : '';
  const ackLine = einv.irnAckNumber
    ? `<div>Ack No: <b>${einv.irnAckNumber}</b>&nbsp;&nbsp;Ack Date: <b>${einv.irnAckDate ? new Date(einv.irnAckDate).toLocaleString('en-IN') : ''}</b></div>`
    : '';

  return `
    <div style="margin-top:16px;border-top:1px solid #ddd;padding-top:12px;background:${bgColor};padding:10px 14px;border-radius:6px;display:flex;gap:12px;align-items:flex-start;">
      ${qrHtml}
      <div style="flex:1;font-size:11px;color:#333;">
        <div style="font-weight:700;margin-bottom:4px;">e-Invoice Status: ${label}</div>
        ${ackLine}
        ${irnLine}
        ${cancelBtn}
      </div>
    </div>
  `;
}
