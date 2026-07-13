const TYPE_LABELS = { TOPUP: 'Top up', TRANSFER_IN: 'Transfer in', TRANSFER_OUT: 'Transfer out', INVOICE_PAYMENT: 'Invoice payment', ADJUSTMENT: 'Adjustment' };

async function loadWallet() {
  try {
    const res = await portalFetch('/api/portal/wallet');
    if (!res.ok) {
      let errMsg = `Server returned ${res.status}`;
      try { const errData = await res.json(); errMsg = errData.error || errMsg; } catch (_) {}
      throw new Error(errMsg);
    }
    const data = await res.json();
    const balance = Number(data.balance);

    const balanceEl = document.getElementById('balanceValue');
    balanceEl.textContent = formatRupees(balance);
    balanceEl.classList.toggle('negative', balance < 0);
    document.getElementById('tierBadge').textContent = TIER_LABELS[portalCustomer.tier] || portalCustomer.tier;
    document.getElementById('tierBadge').className = `tierBadge ${portalCustomer.tier}`;

    document.getElementById('txnRows').innerHTML = data.transactions.length
      ? data.transactions.map((t) => `
          <tr>
            <td>${formatDateTime(t.createdAt)}</td>
            <td>${TYPE_LABELS[t.type] || t.type}</td>
            <td class="num">${['TRANSFER_OUT', 'INVOICE_PAYMENT'].includes(t.type) ? '−' : '+'}${formatRupees(t.amount)}</td>
            <td class="num">${formatRupees(t.balanceAfter)}</td>
            <td>${t.notes || '—'}</td>
          </tr>
        `).join('')
      : '<tr><td colspan="5" class="empty">No transactions yet.</td></tr>';
  } catch (err) {
    console.error('loadWallet failed:', err);
    document.getElementById('balanceValue').textContent = 'Error';
    document.getElementById('txnRows').innerHTML = `<tr><td colspan="5" class="empty" style="color:#a11e1e;">Could not load wallet: ${err.message}</td></tr>`;
  }
}

async function loadTopupRequests() {
  try {
    const res = await portalFetch('/api/portal/wallet/topup-requests');
    if (!res.ok) throw new Error(`Server returned ${res.status}`);
    const requests = await res.json();
    document.getElementById('topupRequestRows').innerHTML = requests.length
      ? requests.map((r) => `
          <tr>
            <td>${formatDate(r.requestedAt)}</td>
            <td class="num">${formatRupees(r.amount)}</td>
            <td>${r.notes || '—'}</td>
            <td><span class="statusTag ${r.status}">${r.status}</span></td>
          </tr>
        `).join('')
      : '<tr><td colspan="4" class="empty">No top-up requests yet.</td></tr>';
  } catch (err) {
    console.error('loadTopupRequests failed:', err);
    document.getElementById('topupRequestRows').innerHTML = `<tr><td colspan="4" class="empty" style="color:#a11e1e;">Could not load requests: ${err.message}</td></tr>`;
  }
}

const topupModal = document.getElementById('topupModal');
document.getElementById('topupBtn').addEventListener('click', () => {
  document.getElementById('tu_amount').value = '';
  document.getElementById('tu_notes').value = '';
  document.getElementById('tu_error').style.display = 'none';
  topupModal.style.display = 'flex';
});
document.getElementById('tu_cancel').addEventListener('click', () => { topupModal.style.display = 'none'; });
document.getElementById('tu_save').addEventListener('click', async () => {
  const errorBox = document.getElementById('tu_error');
  const amount = document.getElementById('tu_amount').value;
  if (!amount || Number(amount) <= 0) {
    errorBox.textContent = 'Enter an amount greater than zero.';
    errorBox.style.display = 'block';
    return;
  }
  const res = await portalFetch('/api/portal/wallet/topup-requests', {
    method: 'POST',
    body: JSON.stringify({ amount, notes: document.getElementById('tu_notes').value || undefined }),
  });
  const data = await res.json();
  if (!res.ok) { errorBox.textContent = data.error || 'Could not submit request'; errorBox.style.display = 'block'; return; }
  topupModal.style.display = 'none';
  loadTopupRequests();
});

// ── Online payment via Razorpay ────────────────────────────────────
async function loadGatewayStatus() {
  try {
    const res = await portalFetch('/api/portal/wallet/topup/gateway-status');
    const data = await res.json();
    document.getElementById('payOnlineBtn').style.display = data.enabled ? 'inline-block' : 'none';
    document.getElementById('gatewayDisabledNote').style.display = data.enabled ? 'none' : 'block';
  } catch (err) {
    console.error('loadGatewayStatus failed:', err);
  }
}

const payOnlineModal = document.getElementById('payOnlineModal');
document.getElementById('payOnlineBtn').addEventListener('click', () => {
  document.getElementById('po_amount').value = '';
  document.getElementById('po_error').style.display = 'none';
  payOnlineModal.style.display = 'flex';
});
document.getElementById('po_cancel').addEventListener('click', () => { payOnlineModal.style.display = 'none'; });

document.getElementById('po_pay').addEventListener('click', async () => {
  const errorBox = document.getElementById('po_error');
  errorBox.style.display = 'none';
  const amount = document.getElementById('po_amount').value;
  if (!amount || Number(amount) <= 0) {
    errorBox.textContent = 'Enter an amount greater than zero.';
    errorBox.style.display = 'block';
    return;
  }

  const orderRes = await portalFetch('/api/portal/wallet/topup/create-order', {
    method: 'POST',
    body: JSON.stringify({ amount }),
  });
  const order = await orderRes.json();
  if (!orderRes.ok) {
    errorBox.textContent = order.error || 'Could not start payment';
    errorBox.style.display = 'block';
    return;
  }

  payOnlineModal.style.display = 'none';

  const rzp = new Razorpay({
    key: order.keyId,
    amount: order.amountPaise,
    currency: 'INR',
    name: order.companyName || 'MNR Broadband',
    description: 'Wallet top-up',
    order_id: order.orderId,
    prefill: { name: portalCustomer.name },
    theme: { color: '#1a73e8' },
    handler: async function (response) {
      const verifyRes = await portalFetch('/api/portal/wallet/topup/verify', {
        method: 'POST',
        body: JSON.stringify({
          razorpay_order_id: response.razorpay_order_id,
          razorpay_payment_id: response.razorpay_payment_id,
          razorpay_signature: response.razorpay_signature,
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) {
        alert(`Payment received, but verification failed: ${verifyData.error || 'unknown error'}. Contact MNR with your payment ID: ${response.razorpay_payment_id}`);
        return;
      }
      alert(`Payment successful! Your new balance is ${formatRupees(verifyData.newBalance)}.`);
      loadWallet();
    },
    modal: {
      ondismiss: function () {
        // User closed the checkout without paying — nothing to do, the
        // GatewayTopupOrder stays in CREATED status and is simply unused.
      },
    },
  });
  rzp.open();
});

loadWallet();
loadTopupRequests();
loadGatewayStatus();
