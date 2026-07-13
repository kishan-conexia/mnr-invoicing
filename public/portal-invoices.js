// Small inline icon set (currentColor, 16px) — no icon-font dependency.
const ICON_VIEW = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
const ICON_DOWNLOAD = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v12"/><path d="M7 11l5 5 5-5"/><path d="M4 21h16"/></svg>';
const ICON_MAIL = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 7l10 6 10-6"/></svg>';
const ICON_WHATSAPP = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12.04 2C6.58 2 2.13 6.45 2.13 11.91c0 1.75.46 3.45 1.32 4.95L2 22l5.29-1.39c1.45.79 3.08 1.21 4.75 1.21h.005c5.46 0 9.91-4.45 9.91-9.91 0-2.65-1.03-5.14-2.9-7.01A9.876 9.876 0 0012.04 2zm5.82 14.02c-.24.68-1.4 1.32-1.93 1.4-.5.08-1.12.11-1.81-.11-.42-.13-.96-.31-1.65-.61-2.9-1.25-4.8-4.17-4.94-4.36-.14-.19-1.19-1.58-1.19-3.01 0-1.43.75-2.13 1.02-2.42.27-.29.58-.36.78-.36h.56c.18 0 .42-.03.65.5.24.56.81 1.95.88 2.09.07.14.12.31.02.5-.1.19-.15.31-.29.48-.14.17-.3.38-.43.51-.14.14-.29.29-.13.57.17.29.75 1.24 1.62 2.01 1.11.99 2.05 1.3 2.34 1.44.29.14.46.12.63-.07.17-.19.72-.84.91-1.13.19-.29.38-.24.63-.14.26.1 1.63.77 1.91.91.29.14.48.22.55.34.07.12.07.7-.17 1.38z"/></svg>';

async function emailInvoice(invoiceId, invoiceNumber, defaultEmail) {
  const email = prompt(`Send invoice ${invoiceNumber} to which email address?`, defaultEmail || '');
  if (!email) return;
  const res = await portalFetch(`/api/portal/invoices/${invoiceId}/send-email`, {
    method: 'POST',
    body: JSON.stringify({ toEmail: email }),
  });
  const data = await res.json();
  alert(res.ok ? `Sent to ${email}.` : (data.error || 'Could not send email'));
}

async function whatsappInvoice(invoiceId, invoiceNumber, total) {
  const res = await portalFetch(`/api/portal/invoices/${invoiceId}/share-link`, { method: 'POST' });
  const data = await res.json();
  if (!res.ok) { alert(data.error || 'Could not create share link'); return; }
  const message = `Invoice ${invoiceNumber} for ${formatRupees(total)}. View it here: ${data.url}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(message)}`, '_blank');
}

function actionCell(inv) {
  return `
    <td class="rowActions">
      <a href="/portal-invoice-view.html?id=${inv.id}" title="View">${ICON_VIEW}</a>
      <a href="/portal-invoice-view.html?id=${inv.id}&download=1" target="_blank" title="Download">${ICON_DOWNLOAD}</a>
      <button class="iconBtn" data-action="mail" data-id="${inv.id}" data-num="${inv.invoiceNumber || ''}" title="Email">${ICON_MAIL}</button>
      <button class="iconBtn" data-action="whatsapp" data-id="${inv.id}" data-num="${inv.invoiceNumber || ''}" data-total="${inv.totalValue}" title="WhatsApp">${ICON_WHATSAPP}</button>
    </td>
  `;
}

function wireActionButtons() {
  document.querySelectorAll('[data-action="mail"]').forEach((btn) => {
    btn.addEventListener('click', () => emailInvoice(btn.dataset.id, btn.dataset.num));
  });
  document.querySelectorAll('[data-action="whatsapp"]').forEach((btn) => {
    btn.addEventListener('click', () => whatsappInvoice(btn.dataset.id, btn.dataset.num, btn.dataset.total));
  });
}

async function load() {
  if (portalCustomer.tier !== 'CUSTOMER') {
    document.getElementById('issueInvoiceSection').style.display = 'block';
    const walletRes = await portalFetch('/api/portal/wallet');
    const wallet = await walletRes.json();
    const gateNote = document.getElementById('gateNote');
    const createBtn = document.getElementById('createInvoiceBtn');
    if (Number(wallet.balance) <= 0) {
      gateNote.textContent = `You need a positive wallet balance before you can create invoices for your downline. Current balance: ${formatRupees(wallet.balance)}.`;
      gateNote.style.display = 'block';
      createBtn.style.pointerEvents = 'none';
      createBtn.style.opacity = '0.5';
      createBtn.title = 'Blocked: your wallet balance must be positive first';
    }
  }

  const res = await portalFetch('/api/portal/invoices');
  const data = await res.json();

  document.getElementById('invoiceRows').innerHTML = data.billedToYou.length
    ? data.billedToYou.map((inv) => `
        <tr>
          <td>${inv.invoiceNumber || '(draft)'}</td>
          <td>${formatDate(inv.invoiceDate)}</td>
          <td>${formatDate(inv.dueDate)}</td>
          <td class="num">${formatRupees(inv.totalValue)}</td>
          <td><span class="badge ${inv.status}">${inv.status.replace('_', ' ')}</span></td>
          ${actionCell(inv)}
        </tr>
      `).join('')
    : '<tr><td colspan="6" class="empty">No invoices yet.</td></tr>';

  document.getElementById('issuedInvoiceRows').innerHTML = data.issuedByYou.length
    ? data.issuedByYou.map((inv) => `
        <tr>
          <td>${inv.invoiceNumber || '(draft)'}</td>
          <td>${inv.customer.displayName || inv.customer.companyName || inv.customer.name}</td>
          <td>${formatDate(inv.invoiceDate)}</td>
          <td class="num">${formatRupees(inv.totalValue)}</td>
          <td><span class="badge ${inv.status}">${inv.status.replace('_', ' ')}</span></td>
          ${actionCell(inv)}
        </tr>
      `).join('')
    : '<tr><td colspan="6" class="empty">You haven\'t issued any invoices yet.</td></tr>';

  wireActionButtons();
}

load();
