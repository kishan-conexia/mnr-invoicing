async function load() {
  const [walletRes, invoicesRes, downlineRes] = await Promise.all([
    portalFetch('/api/portal/wallet'),
    portalFetch('/api/portal/invoices'),
    portalCustomer.tier !== 'CUSTOMER' ? portalFetch('/api/portal/downline') : Promise.resolve(null),
  ]);

  const wallet = await walletRes.json();
  const balanceEl = document.getElementById('balanceValue');
  balanceEl.textContent = formatRupees(wallet.balance);
  balanceEl.classList.toggle('negative', Number(wallet.balance) < 0);
  document.getElementById('tierBadge').textContent = TIER_LABELS[portalCustomer.tier] || portalCustomer.tier;
  document.getElementById('tierBadge').className = `tierBadge ${portalCustomer.tier}`;

  const invoiceData = await invoicesRes.json();
  const billed = invoiceData.billedToYou;
  const outstanding = billed
    .filter((inv) => inv.status !== 'CANCELLED')
    .reduce((sum, inv) => sum + (Number(inv.totalValue) - Number(inv.amountPaid)), 0);
  document.getElementById('outstandingValue').textContent = formatRupees(outstanding);
  document.getElementById('invoiceCountNote').textContent = `Across ${billed.length} invoice${billed.length === 1 ? '' : 's'}`;

  if (downlineRes) {
    const downline = await downlineRes.json();
    document.getElementById('downlineCount').textContent = downline.length;
  } else {
    document.getElementById('downlineCount').textContent = '—';
  }
}

load();
