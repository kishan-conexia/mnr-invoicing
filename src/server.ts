import 'dotenv/config';
import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import cors from 'cors';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import multer from 'multer';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-only-secret-change-me';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

// Logos are saved under public/uploads/logos so express.static above serves
// them directly at /uploads/logos/<file> — no separate route needed.
const uploadsDir = path.join(__dirname, '..', 'public', 'uploads', 'logos');
fs.mkdirSync(uploadsDir, { recursive: true });
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, uploadsDir),
    filename: (_req, file, cb) => cb(null, `logo-${Date.now()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: 3 * 1024 * 1024 }, // 3MB
  fileFilter: (_req, file, cb) => {
    const ok = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'].includes(file.mimetype);
    if (ok) {
      cb(null, true);
    } else {
      cb(new Error('Logo must be a PNG, JPEG, WEBP, or SVG image'));
    }
  },
});

// ── Login ──────────────────────────────────────────────
// Checks the email/password against the User table (bcrypt-hashed password),
// and if correct, hands back a signed token the frontend must send on every
// future request as proof of who's logged in.
app.post('/api/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password are required' });
  }

  const user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const passwordMatches = await bcrypt.compare(password, user.passwordHash);
  if (!passwordMatches) {
    return res.status(401).json({ error: 'Invalid email or password' });
  }

  const token = jwt.sign({ userId: user.id, role: user.role.name }, JWT_SECRET, { expiresIn: '8h' });
  res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: user.role.name } });
});

// ── Auth guard ─────────────────────────────────────────
// Any route that uses this only runs if a valid token was sent.
// This is what "you must be logged in" actually means in code.
function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  try {
    const payload: any = jwt.verify(header.slice(7), JWT_SECRET);
    // A portal (customer) token must never be usable against internal admin
    // routes, even though it's signed with the same secret.
    if (payload.scope === 'portal') throw new Error('wrong scope');
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

// ── Customer Portal auth ────────────────────────────────
// Separate login for customers/distributors/partners themselves — distinct
// from staff logins above. Portal tokens carry scope:'portal' and a
// customerId instead of a userId, and are rejected by requireAuth above.
function requirePortalAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Not logged in' });
  }
  try {
    const payload: any = jwt.verify(header.slice(7), JWT_SECRET);
    if (payload.scope !== 'portal' || !payload.customerId) throw new Error('wrong scope');
    (req as any).portalCustomerId = payload.customerId;
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

app.post('/api/portal/auth/login', async (req: Request, res: Response) => {
  const { email, password } = req.body ?? {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required' });

  const customer = await prisma.customer.findUnique({ where: { portalEmail: email } });
  if (!customer || !customer.portalPasswordHash || customer.status !== 'ACTIVE') {
    return res.status(401).json({ error: 'Invalid email or password' });
  }
  const matches = await bcrypt.compare(password, customer.portalPasswordHash);
  if (!matches) return res.status(401).json({ error: 'Invalid email or password' });

  const token = jwt.sign({ customerId: customer.id, scope: 'portal' }, JWT_SECRET, { expiresIn: '8h' });
  res.json({
    token,
    customer: { id: customer.id, name: customer.displayName || customer.companyName || customer.name, tier: customer.tier },
  });
});

app.get('/api/portal/me', requirePortalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, include: { wallet: true, parent: true } });
  if (!customer) return res.status(404).json({ error: 'Not found' });
  const { portalPasswordHash, ...safe } = customer;
  res.json({ ...safe, walletBalance: customer.wallet ? customer.wallet.balance : 0 });
});

app.get('/api/portal/invoices', requirePortalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const [billed, issued] = await Promise.all([
    prisma.invoice.findMany({ where: { customerId }, include: { customer: true }, orderBy: { createdAt: 'desc' } }),
    prisma.invoice.findMany({ where: { issuedByCustomerId: customerId }, include: { customer: true }, orderBy: { createdAt: 'desc' } }),
  ]);
  res.json({
    billedToYou: billed,
    issuedByYou: issued,
  });
});

app.get('/api/portal/invoices/:id', requirePortalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { items: true, customer: true } });
  if (!invoice || (invoice.customerId !== customerId && invoice.issuedByCustomerId !== customerId)) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  res.json(invoice);
});

app.post('/api/portal/invoices/:id/share-link', requirePortalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
  if (!invoice || (invoice.customerId !== customerId && invoice.issuedByCustomerId !== customerId)) {
    return res.status(404).json({ error: 'Invoice not found' });
  }
  try {
    const token = await ensureShareToken(req.params.id);
    res.json({ shareToken: token, url: `${req.protocol}://${req.get('host')}/public-invoice-view.html?token=${token}` });
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Could not create share link' });
  }
});

app.post('/api/portal/invoices/:id/send-email', requirePortalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const { toEmail } = req.body ?? {};
  if (!toEmail) return res.status(400).json({ error: 'Recipient email is required' });

  const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { customer: true } });
  if (!invoice || (invoice.customerId !== customerId && invoice.issuedByCustomerId !== customerId)) {
    return res.status(404).json({ error: 'Invoice not found' });
  }

  try {
    const company = await prisma.company.findFirst();
    if (!company) return res.status(500).json({ error: 'No company configured' });
    const token = await ensureShareToken(req.params.id);
    const publicUrl = `${req.protocol}://${req.get('host')}/public-invoice-view.html?token=${token}`;
    await sendInvoiceEmail(company, toEmail, invoice, publicUrl);
    res.json({ success: true });
  } catch (err: any) {
    console.error('portal send-email failed:', err);
    res.status(400).json({ error: err.message || 'Could not send email' });
  }
});

// Read-only catalogue access for the portal's invoice-creation form.
app.get('/api/portal/products', requirePortalAuth, async (_req: Request, res: Response) => {
  const products = await prisma.productService.findMany({ where: { isActive: true }, include: { taxRate: true }, orderBy: { name: 'asc' } });
  res.json(products);
});
app.get('/api/portal/tax-rates', requirePortalAuth, async (_req: Request, res: Response) => {
  const rates = await prisma.taxRate.findMany({ where: { isActive: true }, orderBy: { ratePct: 'asc' } });
  res.json(rates);
});
app.get('/api/portal/company', requirePortalAuth, async (_req: Request, res: Response) => {
  const company = await prisma.company.findFirst();
  if (!company) return res.status(404).json({ error: 'No company configured' });
  const { razorpayKeySecret, razorpayKeyId, resendApiKey, ...safe } = company;
  res.json(safe);
});

// A distributor/partner/customer bills their own direct downline. Gated on
// having a positive wallet balance — no balance, no invoicing, matching how
// this hierarchy runs on prepaid credit rather than post-paid trust. Invoices
// created here are finalized immediately, same as the admin flow — the
// portal never exposes an edit capability, so once created they're final.
app.post('/api/portal/invoices', requirePortalAuth, async (req: Request, res: Response) => {
  const issuerId = (req as any).portalCustomerId;
  const { customerId, invoiceDate, dueDate, items } = req.body ?? {};

  if (!customerId || !invoiceDate || !dueDate || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Customer, invoice date, due date, and at least one line item are required' });
  }

  const issuer = await prisma.customer.findUnique({ where: { id: issuerId }, include: { wallet: true } });
  if (!issuer) return res.status(404).json({ error: 'Your account was not found' });

  const targetCustomer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!targetCustomer) return res.status(404).json({ error: 'Customer not found' });
  if (targetCustomer.parentCustomerId !== issuerId) {
    return res.status(400).json({ error: 'You can only create invoices for customers directly under you in the hierarchy' });
  }
  if (!targetCustomer.stateCode) {
    return res.status(400).json({ error: 'This customer has no state code set — required to calculate GST correctly' });
  }

  const company = await prisma.company.findFirst();
  if (!company) return res.status(500).json({ error: 'No company is configured in the database yet' });
  const financialYear = await prisma.financialYear.findFirst({ where: { companyId: company.id, isCurrent: true } });
  if (!financialYear) return res.status(500).json({ error: 'No current financial year is configured' });

  const companyStateCode = (company.gstin || '').slice(0, 2);
  const isIntraState = targetCustomer.stateCode === companyStateCode;
  const taxType = isIntraState ? 'CGST_SGST' : 'IGST';
  const totals = calculateInvoiceTotals(items, isIntraState);

  // The invoice draws down the issuer's own prepaid balance — they're
  // spending their own wallet to bill their downline, same principle as a
  // telecom distributor's recharge balance. Not enough balance, no invoice.
  const availableBalance = issuer.wallet ? Number(issuer.wallet.balance) : 0;
  if (availableBalance < totals.totalValue) {
    return res.status(400).json({
      error: `Insufficient wallet balance: this invoice totals ₹${totals.totalValue.toFixed(2)} but your wallet only has ₹${availableBalance.toFixed(2)}. Top up first.`,
    });
  }

  try {
    const invoice = await prisma.$transaction(async (tx) => {
      const invoiceNumber = await nextDocumentNumber(tx, company.id, financialYear.id, financialYear.label, 'INVOICE');
      const created = await tx.invoice.create({
        data: {
          companyId: company.id,
          customerId: targetCustomer.id,
          issuedByCustomerId: issuerId,
          invoiceNumber,
          invoiceDate: new Date(invoiceDate),
          dueDate: new Date(dueDate),
          placeOfSupplyState: targetCustomer.state || targetCustomer.stateCode || 'Unknown',
          taxType: taxType as any,
          subtotal: totals.subtotal,
          taxableValue: totals.taxableValue,
          cgstAmount: totals.cgstAmount,
          sgstAmount: totals.sgstAmount,
          igstAmount: totals.igstAmount,
          roundOff: totals.roundOff,
          totalValue: totals.totalValue,
          status: 'FINALIZED',
          finalizedAt: new Date(),
          shareToken: crypto.randomBytes(16).toString('hex'),
          items: { create: totals.lineItems },
        },
        include: { items: true, customer: true },
      });

      // Re-check the wallet balance inside the transaction (not just the
      // value fetched earlier) so two invoices submitted at the same instant
      // can't both spend the same rupee.
      const wallet = await tx.wallet.upsert({
        where: { customerId: issuerId },
        create: { customerId: issuerId, balance: 0 },
        update: {},
      });
      if (Number(wallet.balance) < totals.totalValue - 0.01) {
        throw new Error(`Insufficient wallet balance: this invoice totals ₹${totals.totalValue.toFixed(2)} but your wallet only has ₹${Number(wallet.balance).toFixed(2)}.`);
      }
      const newBalance = Math.round((Number(wallet.balance) - totals.totalValue) * 100) / 100;
      await tx.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id, type: 'INVOICE_PAYMENT', amount: totals.totalValue, balanceAfter: newBalance,
          referenceType: 'INVOICE', referenceId: created.id,
          notes: `Invoice ${created.invoiceNumber} to ${targetCustomer.displayName || targetCustomer.companyName || targetCustomer.name}`,
        },
      });

      return created;
    });

    res.status(201).json(invoice);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Could not create invoice' });
  }
});

// ── Wallet balance & history ─────────────────────────────────────────
app.get('/api/portal/wallet', requirePortalAuth, async (req: Request, res: Response) => {
  try {
    const customerId = (req as any).portalCustomerId;
    const wallet = await prisma.wallet.findUnique({
      where: { customerId },
      include: { transactions: { orderBy: { createdAt: 'desc' }, take: 50 } },
    });
    res.json({ balance: wallet ? wallet.balance : 0, transactions: wallet ? wallet.transactions : [] });
  } catch (err: any) {
    console.error('GET /api/portal/wallet failed:', err);
    res.status(500).json({ error: 'Could not load wallet' });
  }
});

// ── Online top-up via Razorpay ──────────────────────────────────────
// Talks to Razorpay's REST API directly with Basic Auth rather than pulling
// in their SDK — one dependency less for a handful of calls.
async function razorpayRequest(keyId: string, keySecret: string, method: string, path: string, body?: any) {
  const auth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
  const res = await fetch(`https://api.razorpay.com${path}`, {
    method,
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data?.error?.description || 'Razorpay request failed');
  return data;
}

// Public-safe: only reveals whether online payment is configured and the
// publishable key ID (never the secret) — needed before the portal even
// shows the "Pay online" button.
app.get('/api/portal/wallet/topup/gateway-status', requirePortalAuth, async (_req: Request, res: Response) => {
  const company = await prisma.company.findFirst();
  const enabled = !!(company?.razorpayKeyId && company?.razorpayKeySecret);
  res.json({ enabled, keyId: enabled ? company!.razorpayKeyId : null, companyName: company?.name });
});

app.post('/api/portal/wallet/topup/create-order', requirePortalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const { amount } = req.body ?? {};
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

  const company = await prisma.company.findFirst();
  if (!company?.razorpayKeyId || !company?.razorpayKeySecret) {
    return res.status(400).json({ error: 'Online payments are not configured yet — ask MNR to set this up in Settings' });
  }

  try {
    const amountPaise = Math.round(Number(amount) * 100);
    const order = await razorpayRequest(company.razorpayKeyId, company.razorpayKeySecret, 'POST', '/v1/orders', {
      amount: amountPaise,
      currency: 'INR',
      receipt: `topup_${Date.now()}`,
      notes: { customerId },
    });

    await prisma.gatewayTopupOrder.create({
      data: { customerId, amount: Number(amount), razorpayOrderId: order.id, status: 'CREATED' },
    });

    res.json({ orderId: order.id, amountPaise, keyId: company.razorpayKeyId, companyName: company.name });
  } catch (err: any) {
    console.error('Razorpay order creation failed:', err);
    res.status(500).json({ error: err.message || 'Could not start payment' });
  }
});

app.post('/api/portal/wallet/topup/verify', requirePortalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body ?? {};
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    return res.status(400).json({ error: 'Missing payment confirmation details' });
  }

  const order = await prisma.gatewayTopupOrder.findUnique({ where: { razorpayOrderId: razorpay_order_id } });
  if (!order || order.customerId !== customerId) return res.status(404).json({ error: 'Order not found' });
  if (order.status !== 'CREATED') return res.status(400).json({ error: 'This order has already been processed' });

  const company = await prisma.company.findFirst();
  if (!company?.razorpayKeySecret) return res.status(500).json({ error: 'Gateway not configured' });

  // The one step that actually proves the payment is real: Razorpay signs
  // order_id|payment_id with the merchant's secret key. If our recomputed
  // signature doesn't match byte-for-byte, this was not a genuine payment —
  // the wallet must never be credited on an unverified claim.
  const expectedSignature = crypto
    .createHmac('sha256', company.razorpayKeySecret)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  if (expectedSignature !== razorpay_signature) {
    await prisma.gatewayTopupOrder.update({ where: { id: order.id }, data: { status: 'FAILED' } });
    return res.status(400).json({ error: 'Payment signature verification failed' });
  }

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { customerId },
      create: { customerId, balance: 0 },
      update: {},
    });
    const newBalance = Math.round((Number(wallet.balance) + Number(order.amount)) * 100) / 100;
    const updatedWallet = await tx.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });
    await tx.walletTransaction.create({
      data: {
        walletId: wallet.id, type: 'TOPUP', amount: Number(order.amount), balanceAfter: newBalance,
        referenceType: 'GATEWAY_PAYMENT', referenceId: razorpay_payment_id, notes: 'Online payment via Razorpay',
      },
    });
    await tx.gatewayTopupOrder.update({
      where: { id: order.id },
      data: { status: 'PAID', razorpayPaymentId: razorpay_payment_id, paidAt: new Date() },
    });
    return updatedWallet;
  });

  res.json({ newBalance: result.balance });
});


app.post('/api/portal/wallet/topup-requests', requirePortalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const { amount, notes } = req.body ?? {};
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

  const request = await prisma.walletTopupRequest.create({
    data: { customerId, amount: Number(amount), notes: notes || null },
  });
  res.status(201).json(request);
});

app.get('/api/portal/wallet/topup-requests', requirePortalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const requests = await prisma.walletTopupRequest.findMany({ where: { customerId }, orderBy: { requestedAt: 'desc' } });
  res.json(requests);
});

// ── Admin review of portal top-up requests ─────────────────────────────
app.get('/api/wallet-topup-requests', requireAuth, async (req: Request, res: Response) => {
  const { status } = req.query;
  const requests = await prisma.walletTopupRequest.findMany({
    where: status ? { status: String(status) } : undefined,
    include: { customer: true, reviewedBy: true },
    orderBy: { requestedAt: 'desc' },
  });
  res.json(requests);
});

app.post('/api/wallet-topup-requests/:id/approve', requireAuth, async (req: Request, res: Response) => {
  const request = await prisma.walletTopupRequest.findUnique({ where: { id: req.params.id }, include: { customer: true } });
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'PENDING') return res.status(400).json({ error: 'This request has already been reviewed' });

  try {
    const result = await prisma.$transaction(async (tx) => {
      const wallet = await tx.wallet.upsert({
        where: { customerId: request.customerId },
        create: { customerId: request.customerId, balance: 0 },
        update: {},
      });
      const newBalance = Math.round((Number(wallet.balance) + Number(request.amount)) * 100) / 100;
      const updatedWallet = await tx.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });
      await tx.walletTransaction.create({
        data: {
          walletId: wallet.id, type: 'TOPUP', amount: Number(request.amount), balanceAfter: newBalance,
          referenceType: 'TOPUP_REQUEST', referenceId: request.id, notes: request.notes,
        },
      });
      const updatedRequest = await tx.walletTopupRequest.update({
        where: { id: request.id },
        data: { status: 'APPROVED', reviewedAt: new Date() },
      });
      return { request: updatedRequest, newBalance: updatedWallet.balance };
    });

    // Explicit, unambiguous confirmation of exactly which customer and wallet
    // were credited — makes any customerId/duplicate-record mismatch visible
    // immediately instead of silently showing a stale balance elsewhere.
    res.json({
      ...result.request,
      customerId: request.customerId,
      customerName: request.customer.displayName || request.customer.companyName || request.customer.name,
      newBalance: result.newBalance,
    });
  } catch (err: any) {
    console.error('Top-up approval failed:', err);
    res.status(500).json({ error: `Approval failed: ${err.message || 'unknown error'}` });
  }
});

app.post('/api/wallet-topup-requests/:id/reject', requireAuth, async (req: Request, res: Response) => {
  const request = await prisma.walletTopupRequest.findUnique({ where: { id: req.params.id } });
  if (!request) return res.status(404).json({ error: 'Request not found' });
  if (request.status !== 'PENDING') return res.status(400).json({ error: 'This request has already been reviewed' });

  const updated = await prisma.walletTopupRequest.update({
    where: { id: request.id },
    data: { status: 'REJECTED', reviewedAt: new Date() },
  });
  res.json(updated);
});

// A distributor/partner's own downline — hidden entirely for the bottom-tier
// Customer role, since they have nothing beneath them.
app.get('/api/portal/downline', requirePortalAuth, async (req: Request, res: Response) => {
  const customerId = (req as any).portalCustomerId;
  const children = await prisma.customer.findMany({
    where: { parentCustomerId: customerId },
    include: { wallet: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(children.map((c) => ({
    id: c.id, customerCode: c.customerCode, displayName: c.displayName || c.companyName || c.name,
    name: c.name, companyName: c.companyName, gstin: c.gstin, tier: c.tier,
    balance: c.wallet ? c.wallet.balance : 0,
    state: c.state, stateCode: c.stateCode,
    hasPortalLogin: !!c.portalEmail,
  })));
});

// The tier immediately below the portal user's own — enforced server-side so
// a Partner can't accidentally (or deliberately) create another Distributor.
const NEXT_TIER_DOWN: Record<string, string | null> = {
  DISTRIBUTOR_L1: 'DISTRIBUTOR_L2',
  DISTRIBUTOR_L2: 'PARTNER',
  PARTNER: 'CUSTOMER',
  CUSTOMER: null,
};

app.post('/api/portal/customers', requirePortalAuth, async (req: Request, res: Response) => {
  const issuerId = (req as any).portalCustomerId;
  const { name, displayName, companyName, gstin, state, stateCode, billingAddress, portalEmail, portalPassword } = req.body ?? {};

  const issuer = await prisma.customer.findUnique({ where: { id: issuerId } });
  if (!issuer) return res.status(404).json({ error: 'Your account was not found' });

  const childTier = NEXT_TIER_DOWN[issuer.tier];
  if (!childTier) return res.status(400).json({ error: 'Customers cannot create their own downline' });

  if (!name) return res.status(400).json({ error: 'Name is required' });
  if (!displayName || !displayName.trim()) return res.status(400).json({ error: 'Display name is required — this is what will show on invoices' });
  if (!stateCode) return res.status(400).json({ error: 'State is required for GST calculation' });

  const GSTIN_PATTERN = /^[0-9]{2}[A-Z0-9]{13}$/;
  const PINCODE_PATTERN = /^[0-9]{6}$/;
  if (gstin && !GSTIN_PATTERN.test(gstin)) {
    return res.status(400).json({ error: 'GSTIN must be exactly 15 characters: 2 digits followed by 13 letters/numbers' });
  }
  if (billingAddress?.pincode && !PINCODE_PATTERN.test(billingAddress.pincode)) {
    return res.status(400).json({ error: 'Pincode must be exactly 6 digits' });
  }
  if (portalPassword && portalPassword.length < 8) {
    return res.status(400).json({ error: 'Portal password must be at least 8 characters' });
  }
  if (portalPassword && !portalEmail) {
    return res.status(400).json({ error: 'Enter a portal email before setting a portal password' });
  }

  const company = await prisma.company.findFirst();
  if (!company) return res.status(500).json({ error: 'No company is configured in the database yet' });

  // Auto-generate a customer code, retrying past any race-condition collisions.
  let customer;
  const portalPasswordHash = portalPassword ? await bcrypt.hash(portalPassword, 12) : undefined;
  for (let attempt = 0; attempt < 5 && !customer; attempt++) {
    const count = await prisma.customer.count({ where: { companyId: company.id } });
    const candidateCode = `CUST-${String(count + 1 + attempt).padStart(4, '0')}`;
    try {
      customer = await prisma.customer.create({
        data: {
          companyId: company.id,
          customerCode: candidateCode,
          name,
          displayName: displayName.trim(),
          companyName: companyName || undefined,
          gstin: gstin || undefined,
          state, stateCode,
          tier: childTier as any,
          parentCustomerId: issuerId,
          portalEmail: portalEmail || undefined,
          portalPasswordHash,
          addresses: billingAddress?.line1 ? {
            create: [{ type: 'BILLING', line1: billingAddress.line1, city: billingAddress.city, state, stateCode, pincode: billingAddress.pincode }],
          } : undefined,
        },
      });
    } catch (err: any) {
      if (err.code === 'P2002' && err.meta?.target?.includes('portal_email')) {
        return res.status(409).json({ error: 'That portal email is already used by another customer' });
      }
      // customer_code collision — loop retries with a different candidate
    }
  }
  if (!customer) return res.status(500).json({ error: 'Could not generate a unique customer code — try again' });

  res.status(201).json(customer);
});

// ── Customers ──────────────────────────────────────────
app.get('/api/customers', requireAuth, async (_req: Request, res: Response) => {
  const customers = await prisma.customer.findMany({ include: { addresses: true, parent: true }, orderBy: { createdAt: 'desc' } });
  res.json(customers);
});

// Each tier's parent must be exactly the tier above it — Distributor L1 reports
// directly to MNR (no parent row), L2's parent must be an L1, Partner's parent
// must be an L2, and Customer's parent must be a Partner.
const REQUIRED_PARENT_TIER: Record<string, string | null> = {
  DISTRIBUTOR_L1: null,
  DISTRIBUTOR_L2: 'DISTRIBUTOR_L1',
  PARTNER: 'DISTRIBUTOR_L2',
  CUSTOMER: 'PARTNER',
};
const TIER_LABELS: Record<string, string> = {
  DISTRIBUTOR_L1: 'Distributor L1', DISTRIBUTOR_L2: 'Distributor L2', PARTNER: 'Partner', CUSTOMER: 'Customer',
};

async function validateHierarchy(tier: string, parentCustomerId: string | undefined, selfId?: string): Promise<string | null> {
  const requiredParentTier = REQUIRED_PARENT_TIER[tier];
  if (requiredParentTier === undefined) return `Unknown tier "${tier}"`;

  if (requiredParentTier === null) {
    return parentCustomerId ? 'Distributor L1 has no parent — it reports directly to MNR' : null;
  }
  if (!parentCustomerId) {
    return `${TIER_LABELS[tier]} requires a parent ${TIER_LABELS[requiredParentTier]}`;
  }
  if (parentCustomerId === selfId) {
    return 'A customer cannot be its own parent';
  }
  const parent = await prisma.customer.findUnique({ where: { id: parentCustomerId } });
  if (!parent) return 'Selected parent was not found';
  if (parent.tier !== requiredParentTier) {
    return `${TIER_LABELS[tier]}'s parent must be a ${TIER_LABELS[requiredParentTier]}, not a ${TIER_LABELS[parent.tier]}`;
  }
  return null;
}

app.post('/api/customers', requireAuth, async (req: Request, res: Response) => {
  const { customerCode, name, displayName, companyName, gstin, state, stateCode, category, billingAddress, installationAddress, tier, parentCustomerId, portalEmail, portalPassword } = req.body ?? {};
  if (!customerCode || !name) {
    return res.status(400).json({ error: 'Customer code and name are required' });
  }
  if (!displayName || !displayName.trim()) {
    return res.status(400).json({ error: 'Display name is required — this is what will show on invoices' });
  }
  if (portalPassword && portalPassword.length < 8) {
    return res.status(400).json({ error: 'Portal password must be at least 8 characters' });
  }
  if (portalPassword && !portalEmail) {
    return res.status(400).json({ error: 'Enter a portal email before setting a portal password' });
  }

  const resolvedTier = tier || 'CUSTOMER';
  const hierarchyError = await validateHierarchy(resolvedTier, parentCustomerId || undefined);
  if (hierarchyError) return res.status(400).json({ error: hierarchyError });

  const GSTIN_PATTERN = /^[0-9]{2}[A-Z0-9]{13}$/;
  const PINCODE_PATTERN = /^[0-9]{6}$/;
  if (gstin && !GSTIN_PATTERN.test(gstin)) {
    return res.status(400).json({ error: 'GSTIN must be exactly 15 characters: 2 digits followed by 13 letters/numbers' });
  }
  if (billingAddress?.pincode && !PINCODE_PATTERN.test(billingAddress.pincode)) {
    return res.status(400).json({ error: 'Billing pincode must be exactly 6 digits' });
  }
  if (installationAddress?.pincode && !PINCODE_PATTERN.test(installationAddress.pincode)) {
    return res.status(400).json({ error: 'Installation pincode must be exactly 6 digits' });
  }

  const company = await prisma.company.findFirst();
  if (!company) {
    return res.status(500).json({ error: 'No company is configured in the database yet' });
  }

  const existing = await prisma.customer.findFirst({ where: { companyId: company.id, customerCode } });
  if (existing) {
    return res.status(409).json({ error: `Customer code ${customerCode} is already used` });
  }

  const addressesToCreate: any[] = [];
  if (billingAddress?.line1) {
    addressesToCreate.push({ type: 'BILLING', line1: billingAddress.line1, city: billingAddress.city, state, stateCode, pincode: billingAddress.pincode });
  }
  if (installationAddress?.line1) {
    addressesToCreate.push({ type: 'INSTALLATION', line1: installationAddress.line1, city: installationAddress.city, state, stateCode, pincode: installationAddress.pincode });
  }

  const portalPasswordHash = portalPassword ? await bcrypt.hash(portalPassword, 12) : undefined;

  try {
    const customer = await prisma.customer.create({
      data: {
        companyId: company.id, customerCode, name, displayName: displayName.trim(), companyName, gstin, state, stateCode, category,
        tier: resolvedTier, parentCustomerId: parentCustomerId || null,
        portalEmail: portalEmail || undefined, portalPasswordHash,
        addresses: addressesToCreate.length ? { create: addressesToCreate } : undefined,
      },
      include: { addresses: true, parent: true },
    });
    res.status(201).json(customer);
  } catch (err: any) {
    if (err.code === 'P2002' && err.meta?.target?.includes('portal_email')) {
      return res.status(409).json({ error: 'That portal email is already used by another customer' });
    }
    res.status(400).json({ error: 'Could not create customer' });
  }
});

// Edits an existing customer. Address updates replace the existing BILLING/
// INSTALLATION rows for that customer rather than trying to diff them —
// simpler and safe since a customer only ever has one of each type.
app.patch('/api/customers/:id', requireAuth, async (req: Request, res: Response) => {
  const { name, displayName, companyName, gstin, state, stateCode, category, billingAddress, installationAddress, tier, parentCustomerId, portalEmail, portalPassword } = req.body ?? {};
  const existing = await prisma.customer.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: 'Customer not found' });

  if (displayName !== undefined && !displayName.trim()) {
    return res.status(400).json({ error: 'Display name cannot be empty — this is what shows on invoices' });
  }

  if (tier !== undefined) {
    const hierarchyError = await validateHierarchy(tier, parentCustomerId || undefined, req.params.id);
    if (hierarchyError) return res.status(400).json({ error: hierarchyError });
  }

  const GSTIN_PATTERN = /^[0-9]{2}[A-Z0-9]{13}$/;
  const PINCODE_PATTERN = /^[0-9]{6}$/;
  if (gstin && !GSTIN_PATTERN.test(gstin)) {
    return res.status(400).json({ error: 'GSTIN must be exactly 15 characters: 2 digits followed by 13 letters/numbers' });
  }
  if (billingAddress?.pincode && !PINCODE_PATTERN.test(billingAddress.pincode)) {
    return res.status(400).json({ error: 'Billing pincode must be exactly 6 digits' });
  }
  if (installationAddress?.pincode && !PINCODE_PATTERN.test(installationAddress.pincode)) {
    return res.status(400).json({ error: 'Installation pincode must be exactly 6 digits' });
  }
  if (portalPassword && portalPassword.length < 8) {
    return res.status(400).json({ error: 'Portal password must be at least 8 characters' });
  }

  let portalPasswordHash: string | undefined;
  if (portalPassword) portalPasswordHash = await bcrypt.hash(portalPassword, 12);

  try {
    const customer = await prisma.$transaction(async (tx) => {
      if (billingAddress) {
        await tx.customerAddress.deleteMany({ where: { customerId: req.params.id, type: 'BILLING' } });
        if (billingAddress.line1) {
          await tx.customerAddress.create({ data: { customerId: req.params.id, type: 'BILLING', line1: billingAddress.line1, city: billingAddress.city, state, stateCode, pincode: billingAddress.pincode } });
        }
      }
      if (installationAddress) {
        await tx.customerAddress.deleteMany({ where: { customerId: req.params.id, type: 'INSTALLATION' } });
        if (installationAddress.line1) {
          await tx.customerAddress.create({ data: { customerId: req.params.id, type: 'INSTALLATION', line1: installationAddress.line1, city: installationAddress.city, state, stateCode, pincode: installationAddress.pincode } });
        }
      }

      return tx.customer.update({
        where: { id: req.params.id },
        data: {
          name: name ?? undefined,
          displayName: displayName !== undefined ? displayName.trim() : undefined,
          companyName: companyName !== undefined ? companyName : undefined,
          gstin: gstin !== undefined ? gstin : undefined,
          state: state !== undefined ? state : undefined,
          stateCode: stateCode !== undefined ? stateCode : undefined,
          category: category !== undefined ? category : undefined,
          tier: tier !== undefined ? tier : undefined,
          parentCustomerId: tier !== undefined ? (parentCustomerId || null) : undefined,
          portalEmail: portalEmail !== undefined ? (portalEmail || null) : undefined,
          portalPasswordHash: portalPasswordHash !== undefined ? portalPasswordHash : undefined,
        },
        include: { addresses: true, parent: true },
      });
    });

    res.json(customer);
  } catch (err: any) {
    if (err.code === 'P2002' && err.meta?.target?.includes('portal_email')) {
      return res.status(409).json({ error: 'That portal email is already used by another customer' });
    }
    res.status(400).json({ error: 'Could not save customer' });
  }
});

// ── Products & Services ────────────────────────────────
app.get('/api/products', requireAuth, async (_req: Request, res: Response) => {
  const products = await prisma.productService.findMany({
    include: { taxRate: true },
    orderBy: { name: 'asc' },
  });
  res.json(products);
});

app.post('/api/products', requireAuth, async (req: Request, res: Response) => {
  const { name, code, hsnSac, description, unit, standardRate, taxRateId, billingFrequency } = req.body ?? {};
  if (!name || !code || standardRate === undefined || standardRate === null || standardRate === '') {
    return res.status(400).json({ error: 'Name, code, and standard rate are required' });
  }

  const company = await prisma.company.findFirst();
  if (!company) {
    return res.status(500).json({ error: 'No company is configured in the database yet' });
  }

  const existing = await prisma.productService.findFirst({ where: { companyId: company.id, code } });
  if (existing) {
    return res.status(409).json({ error: `Service code ${code} is already used` });
  }

  const product = await prisma.productService.create({
    data: {
      companyId: company.id,
      name,
      code,
      hsnSac: hsnSac || null,
      description: description || null,
      unit: unit || 'NOS',
      standardRate,
      taxRateId: taxRateId || null,
      billingFrequency: billingFrequency || null,
    },
  });
  res.status(201).json(product);
});

// Tax rates — used to populate the dropdown when adding a product/service
app.get('/api/tax-rates', requireAuth, async (_req: Request, res: Response) => {
  const rates = await prisma.taxRate.findMany({ where: { isActive: true }, orderBy: { ratePct: 'asc' } });
  res.json(rates);
});

// ── Invoices ───────────────────────────────────────────
app.get('/api/invoices', requireAuth, async (req: Request, res: Response) => {
  const { customerId } = req.query;
  const invoices = await prisma.invoice.findMany({
    where: customerId ? { customerId: String(customerId) } : undefined,
    include: { customer: true },
    orderBy: { createdAt: 'desc' },
  });
  res.json(invoices);
});

app.get('/api/invoices/:id', requireAuth, async (req: Request, res: Response) => {
  const invoice = await prisma.invoice.findUnique({
    where: { id: req.params.id },
    include: { customer: { include: { addresses: true } }, items: true },
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  res.json(invoice);
});

// ── Sharing: public link, email, WhatsApp ─────────────────────────────
// Old invoices (created before this feature existed) won't have a token yet
// — generate one on first use rather than requiring a migration backfill.
async function ensureShareToken(invoiceId: string): Promise<string> {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) throw new Error('Invoice not found');
  if (invoice.shareToken) return invoice.shareToken;
  const token = crypto.randomBytes(16).toString('hex');
  await prisma.invoice.update({ where: { id: invoiceId }, data: { shareToken: token } });
  return token;
}

async function sendInvoiceEmail(company: any, toEmail: string, invoice: any, publicUrl: string) {
  if (!company.resendApiKey || !company.resendFromEmail) {
    throw new Error('Email is not configured yet — ask MNR to set up Resend in Settings');
  }
  const fromName = company.resendFromName || company.name;
  const amount = Number(invoice.totalValue).toLocaleString('en-IN', { minimumFractionDigits: 2 });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${company.resendApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: `${fromName} <${company.resendFromEmail}>`,
      to: [toEmail],
      subject: `Invoice ${invoice.invoiceNumber} from ${company.name}`,
      html: `
        <p>Dear ${invoice.customer.displayName || invoice.customer.companyName || invoice.customer.name},</p>
        <p>Please find your invoice details below.</p>
        <table style="border-collapse:collapse; font-family:sans-serif; font-size:14px;">
          <tr><td style="padding:4px 12px 4px 0; color:#666;">Invoice #</td><td>${invoice.invoiceNumber}</td></tr>
          <tr><td style="padding:4px 12px 4px 0; color:#666;">Date</td><td>${new Date(invoice.invoiceDate).toLocaleDateString('en-IN')}</td></tr>
          <tr><td style="padding:4px 12px 4px 0; color:#666;">Due date</td><td>${new Date(invoice.dueDate).toLocaleDateString('en-IN')}</td></tr>
          <tr><td style="padding:4px 12px 4px 0; color:#666;">Amount</td><td><b>₹${amount}</b></td></tr>
        </table>
        <p style="margin-top:20px;"><a href="${publicUrl}" style="background:#1a73e8; color:white; padding:10px 18px; border-radius:6px; text-decoration:none;">View Invoice</a></p>
        <p style="color:#888; font-size:12px; margin-top:20px;">${company.name}</p>
      `,
    }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(data?.message || 'Resend could not send the email');
  return data;
}

app.post('/api/invoices/:id/share-link', requireAuth, async (req: Request, res: Response) => {
  try {
    const token = await ensureShareToken(req.params.id);
    res.json({ shareToken: token, url: `${req.protocol}://${req.get('host')}/public-invoice-view.html?token=${token}` });
  } catch (err: any) {
    res.status(404).json({ error: err.message || 'Invoice not found' });
  }
});

app.post('/api/invoices/:id/send-email', requireAuth, async (req: Request, res: Response) => {
  const { toEmail } = req.body ?? {};
  if (!toEmail) return res.status(400).json({ error: 'Recipient email is required' });

  try {
    const company = await prisma.company.findFirst();
    if (!company) return res.status(500).json({ error: 'No company configured' });
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { customer: true } });
    if (!invoice) return res.status(404).json({ error: 'Invoice not found' });

    const token = await ensureShareToken(req.params.id);
    const publicUrl = `${req.protocol}://${req.get('host')}/public-invoice-view.html?token=${token}`;
    await sendInvoiceEmail(company, toEmail, invoice, publicUrl);
    res.json({ success: true });
  } catch (err: any) {
    console.error('send-email failed:', err);
    res.status(400).json({ error: err.message || 'Could not send email' });
  }
});

// Deliberately unauthenticated — this is what email/WhatsApp links point to,
// so anyone with the link can view (and print) the invoice without needing
// a login of any kind. Only reachable via the unguessable share token.
app.get('/api/public/invoices/:token', async (req: Request, res: Response) => {
  const invoice = await prisma.invoice.findUnique({
    where: { shareToken: req.params.token },
    include: { items: true, customer: true },
  });
  if (!invoice) return res.status(404).json({ error: 'Invoice not found' });
  const company = await prisma.company.findFirst();
  const { razorpayKeySecret, razorpayKeyId, resendApiKey, ...safeCompany } = company || ({} as any);
  res.json({ invoice, company: safeCompany });
});

// Creates and immediately finalizes an invoice: assigns the permanent number,
// calculates GST (CGST+SGST for same-state, IGST for inter-state), and totals.
// A fuller build would keep a separate draft stage — this MVP finalizes on save.
// Shared by both the admin invoice form and the portal's "bill your downline"
// flow, so the tax math can't drift between the two entry points.
function calculateInvoiceTotals(items: any[], isIntraState: boolean) {
  let subtotal = 0, taxableValueTotal = 0, cgstTotal = 0, sgstTotal = 0, igstTotal = 0;

  const lineItems = items.map((item: any) => {
    const quantity = Number(item.quantity);
    const rate = Number(item.rate);
    const discountPct = Number(item.discountPct || 0);
    const taxRatePct = Number(item.taxRatePct || 0);

    const gross = quantity * rate;
    const taxableValue = Math.round((gross - (gross * discountPct) / 100) * 100) / 100;
    const taxAmount = Math.round(((taxableValue * taxRatePct) / 100) * 100) / 100;

    let cgstAmount = 0, sgstAmount = 0, igstAmount = 0;
    if (isIntraState) {
      cgstAmount = Math.round((taxAmount / 2) * 100) / 100;
      sgstAmount = taxAmount - cgstAmount;
    } else {
      igstAmount = taxAmount;
    }

    subtotal += gross;
    taxableValueTotal += taxableValue;
    cgstTotal += cgstAmount;
    sgstTotal += sgstAmount;
    igstTotal += igstAmount;

    return {
      productServiceId: item.productServiceId || null,
      description: item.description,
      quantity, rate, discountPct, taxableValue, taxRatePct,
      cgstAmount, sgstAmount, igstAmount,
      lineTotal: Math.round((taxableValue + taxAmount) * 100) / 100,
    };
  });

  const preRoundTotal = taxableValueTotal + cgstTotal + sgstTotal + igstTotal;
  const totalValue = Math.round(preRoundTotal);
  const roundOff = Math.round((totalValue - preRoundTotal) * 100) / 100;

  return {
    lineItems,
    subtotal: Math.round(subtotal * 100) / 100,
    taxableValue: Math.round(taxableValueTotal * 100) / 100,
    cgstAmount: Math.round(cgstTotal * 100) / 100,
    sgstAmount: Math.round(sgstTotal * 100) / 100,
    igstAmount: Math.round(igstTotal * 100) / 100,
    totalValue,
    roundOff,
  };
}

async function nextDocumentNumber(tx: any, companyId: string, financialYearId: string, financialYearLabel: string, documentType: string) {
  const sequence = await tx.numberSequence.findUnique({
    where: { companyId_financialYearId_documentType: { companyId, financialYearId, documentType } },
  });
  if (!sequence) throw new Error(`${documentType} number sequence is not configured`);
  const nextNumber = sequence.lastNumber + 1;
  await tx.numberSequence.update({ where: { id: sequence.id }, data: { lastNumber: nextNumber } });
  return `${sequence.prefix}/${financialYearLabel}/${String(nextNumber).padStart(5, '0')}`;
}

app.post('/api/invoices', requireAuth, async (req: Request, res: Response) => {
  const { customerId, invoiceDate, dueDate, items } = req.body ?? {};

  if (!customerId || !invoiceDate || !dueDate || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Customer, invoice date, due date, and at least one line item are required' });
  }

  const company = await prisma.company.findFirst();
  if (!company) return res.status(500).json({ error: 'No company is configured in the database yet' });

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });
  if (!customer.stateCode) return res.status(400).json({ error: 'This customer has no state code set — required to calculate GST correctly' });

  const financialYear = await prisma.financialYear.findFirst({ where: { companyId: company.id, isCurrent: true } });
  if (!financialYear) return res.status(500).json({ error: 'No current financial year is configured' });

  const companyStateCode = (company.gstin || '').slice(0, 2);
  const isIntraState = customer.stateCode === companyStateCode;
  const taxType = isIntraState ? 'CGST_SGST' : 'IGST';
  const totals = calculateInvoiceTotals(items, isIntraState);

  const invoice = await prisma.$transaction(async (tx) => {
    const invoiceNumber = await nextDocumentNumber(tx, company.id, financialYear.id, financialYear.label, 'INVOICE');
    return tx.invoice.create({
      data: {
        companyId: company.id,
        customerId: customer.id,
        invoiceNumber,
        invoiceDate: new Date(invoiceDate),
        dueDate: new Date(dueDate),
        placeOfSupplyState: customer.state || customer.stateCode || 'Unknown',
        taxType: taxType as any,
        subtotal: totals.subtotal,
        taxableValue: totals.taxableValue,
        cgstAmount: totals.cgstAmount,
        sgstAmount: totals.sgstAmount,
        igstAmount: totals.igstAmount,
        roundOff: totals.roundOff,
        totalValue: totals.totalValue,
        status: 'FINALIZED',
        finalizedAt: new Date(),
        shareToken: crypto.randomBytes(16).toString('hex'),
        items: { create: totals.lineItems },
      },
      include: { items: true, customer: true },
    });
  });

  res.status(201).json(invoice);
});

// Basic company info — used by the frontend to show intra vs inter-state tax hints
// and to render the invoice letterhead (address, PAN, bank details, terms).
// Deliberately unauthenticated — the login page needs the logo before anyone
// is signed in. Only exposes name + logo, nothing sensitive.
app.get('/api/company/public', async (_req: Request, res: Response) => {
  const company = await prisma.company.findFirst();
  res.json({ name: company?.name || null, logoUrl: company?.logoUrl || null });
});

app.get('/api/company', requireAuth, async (_req: Request, res: Response) => {
  const company = await prisma.company.findFirst();
  if (!company) return res.status(404).json({ error: 'No company configured' });
  const { razorpayKeySecret, resendApiKey, ...safe } = company;
  res.json({ ...safe, razorpayKeySecretSet: !!razorpayKeySecret, resendApiKeySet: !!resendApiKey });
});

app.patch('/api/company', requireAuth, async (req: Request, res: Response) => {
  const { name, legalName, gstin, pan, cin, registeredAddress, city, state, stateCode, country, pincode, contactEmail, contactPhone, bankDetails, termsAndConditions, razorpayKeyId, razorpayKeySecret, resendApiKey, resendFromEmail, resendFromName } = req.body ?? {};
  const company = await prisma.company.findFirst();
  if (!company) return res.status(404).json({ error: 'No company configured' });

  const GSTIN_PATTERN = /^[0-9]{2}[A-Z0-9]{13}$/;
  const PINCODE_PATTERN = /^[0-9]{6}$/;
  if (gstin && !GSTIN_PATTERN.test(gstin)) {
    return res.status(400).json({ error: 'GSTIN must be exactly 15 characters: 2 digits followed by 13 letters/numbers' });
  }
  if (pincode && !PINCODE_PATTERN.test(pincode)) {
    return res.status(400).json({ error: 'Pincode must be exactly 6 digits' });
  }

  const updated = await prisma.company.update({
    where: { id: company.id },
    data: {
      name: name !== undefined ? name : undefined,
      legalName: legalName !== undefined ? legalName : undefined,
      gstin: gstin !== undefined ? gstin : undefined,
      pan: pan !== undefined ? pan : undefined,
      cin: cin !== undefined ? cin : undefined,
      registeredAddress: registeredAddress !== undefined ? registeredAddress : undefined,
      city: city !== undefined ? city : undefined,
      state: state !== undefined ? state : undefined,
      stateCode: stateCode !== undefined ? stateCode : undefined,
      country: country !== undefined ? country : undefined,
      pincode: pincode !== undefined ? pincode : undefined,
      contactEmail: contactEmail !== undefined ? contactEmail : undefined,
      contactPhone: contactPhone !== undefined ? contactPhone : undefined,
      bankDetails: bankDetails !== undefined ? bankDetails : undefined,
      razorpayKeyId: razorpayKeyId !== undefined ? razorpayKeyId : undefined,
      razorpayKeySecret: razorpayKeySecret !== undefined ? razorpayKeySecret : undefined,
      resendApiKey: resendApiKey !== undefined ? resendApiKey : undefined,
      resendFromEmail: resendFromEmail !== undefined ? resendFromEmail : undefined,
      resendFromName: resendFromName !== undefined ? resendFromName : undefined,
      termsAndConditions: termsAndConditions !== undefined ? termsAndConditions : undefined,
    },
  });
  res.json(updated);
});

app.post('/api/company/logo', requireAuth, (req: Request, res: Response) => {
  logoUpload.single('logo')(req, res, async (err: any) => {
    if (err) return res.status(400).json({ error: err.message || 'Could not upload logo' });
    if (!req.file) return res.status(400).json({ error: 'No file received' });

    const company = await prisma.company.findFirst();
    if (!company) return res.status(404).json({ error: 'No company configured' });

    // Remove the old logo file so uploads don't pile up indefinitely
    if (company.logoUrl) {
      const oldPath = path.join(__dirname, '..', 'public', company.logoUrl.replace(/^\//, ''));
      fs.unlink(oldPath, () => {});
    }

    const logoUrl = `/uploads/logos/${req.file.filename}`;
    const updated = await prisma.company.update({ where: { id: company.id }, data: { logoUrl } });
    res.json(updated);
  });
});

// ── Payments & Receipts ────────────────────────────────
app.get('/api/payments', requireAuth, async (_req: Request, res: Response) => {
  const payments = await prisma.payment.findMany({
    include: { customer: true, receipt: true, allocations: { include: { invoice: true } } },
    orderBy: { createdAt: 'desc' },
  });
  res.json(payments);
});

app.get('/api/payments/:id', requireAuth, async (req: Request, res: Response) => {
  const payment = await prisma.payment.findUnique({
    where: { id: req.params.id },
    include: { customer: true, receipt: true, allocations: { include: { invoice: true } } },
  });
  if (!payment) return res.status(404).json({ error: 'Payment not found' });
  res.json(payment);
});

// Records a payment and, if allocations are given, applies them against specific
// invoices — updating each invoice's amountPaid/status — all inside one transaction
// so a payment can never be allocated beyond what's actually outstanding.
app.post('/api/payments', requireAuth, async (req: Request, res: Response) => {
  const { customerId, paymentDate, amount, mode, referenceNumber, notes, tdsDeducted, bankCharges, allocations } = req.body ?? {};

  if (!customerId || !paymentDate || !amount || Number(amount) <= 0 || !mode) {
    return res.status(400).json({ error: 'Customer, payment date, amount, and payment mode are required' });
  }

  const company = await prisma.company.findFirst();
  if (!company) return res.status(500).json({ error: 'No company is configured in the database yet' });

  const customer = await prisma.customer.findUnique({ where: { id: customerId } });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const financialYear = await prisma.financialYear.findFirst({ where: { companyId: company.id, isCurrent: true } });
  if (!financialYear) return res.status(500).json({ error: 'No current financial year is configured' });

  const paymentAmount = Number(amount);
  const allocationList = Array.isArray(allocations) ? allocations.filter((a: any) => a.invoiceId && Number(a.amount) > 0) : [];
  const allocatedTotal = allocationList.reduce((sum: number, a: any) => sum + Number(a.amount), 0);

  if (allocatedTotal > paymentAmount + 0.01) {
    return res.status(400).json({ error: 'Total allocated to invoices cannot exceed the payment amount' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      // Re-check each invoice's real outstanding balance inside the transaction,
      // so two payments submitted at the same moment can't both over-allocate.
      for (const alloc of allocationList) {
        const invoice = await tx.invoice.findUnique({ where: { id: alloc.invoiceId } });
        if (!invoice) throw new Error(`Invoice ${alloc.invoiceId} not found`);
        const outstanding = Number(invoice.totalValue) - Number(invoice.amountPaid);
        if (Number(alloc.amount) > outstanding + 0.01) {
          throw new Error(`Allocation of ₹${alloc.amount} to invoice ${invoice.invoiceNumber} exceeds its outstanding balance of ₹${outstanding.toFixed(2)}`);
        }
      }

      // Paying from wallet debits the customer's prepaid balance instead of
      // recording external money in — re-check the real balance inside the
      // transaction so two wallet payments can't both spend the same rupee.
      let wallet = null;
      if (mode === 'WALLET') {
        wallet = await tx.wallet.upsert({
          where: { customerId },
          create: { customerId, balance: 0 },
          update: {},
        });
        if (Number(wallet.balance) < paymentAmount - 0.01) {
          throw new Error(`Wallet balance (₹${Number(wallet.balance).toFixed(2)}) is less than the payment amount (₹${paymentAmount.toFixed(2)})`);
        }
      }

      const payment = await tx.payment.create({
        data: {
          companyId: company.id,
          customerId,
          paymentDate: new Date(paymentDate),
          amount: paymentAmount,
          unallocatedAmount: Math.round((paymentAmount - allocatedTotal) * 100) / 100,
          tdsDeducted: tdsDeducted ? Number(tdsDeducted) : 0,
          bankCharges: bankCharges ? Number(bankCharges) : 0,
          mode,
          referenceNumber: referenceNumber || null,
          notes: notes || null,
        },
      });

      if (mode === 'WALLET' && wallet) {
        const newBalance = Math.round((Number(wallet.balance) - paymentAmount) * 100) / 100;
        await tx.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });
        await tx.walletTransaction.create({
          data: {
            walletId: wallet.id,
            type: 'INVOICE_PAYMENT',
            amount: paymentAmount,
            balanceAfter: newBalance,
            referenceType: 'PAYMENT',
            referenceId: payment.id,
            notes: notes || null,
          },
        });
      }

      for (const alloc of allocationList) {
        await tx.paymentAllocation.create({
          data: { paymentId: payment.id, invoiceId: alloc.invoiceId, amount: Number(alloc.amount) },
        });
        const invoice = await tx.invoice.findUnique({ where: { id: alloc.invoiceId } });
        const newAmountPaid = Number(invoice!.amountPaid) + Number(alloc.amount);
        const newStatus = newAmountPaid >= Number(invoice!.totalValue) - 0.01 ? 'PAID' : 'PARTIALLY_PAID';
        await tx.invoice.update({
          where: { id: alloc.invoiceId },
          data: { amountPaid: newAmountPaid, status: newStatus },
        });
      }

      // Assign the receipt number the same way invoice numbers are assigned —
      // inside the transaction, so concurrent payments can't collide.
      const sequence = await tx.numberSequence.findUnique({
        where: { companyId_financialYearId_documentType: { companyId: company.id, financialYearId: financialYear.id, documentType: 'RECEIPT' } },
      });
      if (!sequence) throw new Error('Receipt number sequence is not configured');
      const nextNumber = sequence.lastNumber + 1;
      await tx.numberSequence.update({ where: { id: sequence.id }, data: { lastNumber: nextNumber } });
      const receiptNumber = `${sequence.prefix}/${financialYear.label}/${String(nextNumber).padStart(5, '0')}`;

      const receipt = await tx.receipt.create({ data: { paymentId: payment.id, receiptNumber } });

      return tx.payment.findUnique({
        where: { id: payment.id },
        include: { customer: true, receipt: true, allocations: { include: { invoice: true } } },
      });
    });

    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Could not record payment' });
  }
});

// ── Wallets ────────────────────────────────────────────
// Every customer in the hierarchy (Distributor L1/L2, Partner, Customer) can
// hold a prepaid balance. Wallets are created lazily on first use rather than
// forced at customer-creation time, so this also covers customers that
// existed before the wallet feature did.
app.get('/api/wallets', requireAuth, async (_req: Request, res: Response) => {
  const customers = await prisma.customer.findMany({
    include: { wallet: true },
    orderBy: { tier: 'asc' },
  });
  res.json(customers.map((c) => ({
    customerId: c.id,
    customerCode: c.customerCode,
    displayName: c.displayName || c.companyName || c.name,
    tier: c.tier,
    parentCustomerId: c.parentCustomerId,
    balance: c.wallet ? c.wallet.balance : 0,
  })));
});

app.get('/api/wallets/:customerId', requireAuth, async (req: Request, res: Response) => {
  const customer = await prisma.customer.findUnique({ where: { id: req.params.customerId } });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const wallet = await prisma.wallet.findUnique({
    where: { customerId: req.params.customerId },
    include: { transactions: { orderBy: { createdAt: 'desc' }, include: { createdBy: true } } },
  });

  res.json({
    customer,
    balance: wallet ? wallet.balance : 0,
    transactions: wallet ? wallet.transactions : [],
  });
});

app.post('/api/wallets/:customerId/topup', requireAuth, async (req: Request, res: Response) => {
  const { amount, notes } = req.body ?? {};
  if (!amount || Number(amount) <= 0) return res.status(400).json({ error: 'Amount must be greater than zero' });

  const customer = await prisma.customer.findUnique({ where: { id: req.params.customerId } });
  if (!customer) return res.status(404).json({ error: 'Customer not found' });

  const result = await prisma.$transaction(async (tx) => {
    const wallet = await tx.wallet.upsert({
      where: { customerId: req.params.customerId },
      create: { customerId: req.params.customerId, balance: 0 },
      update: {},
    });
    const newBalance = Math.round((Number(wallet.balance) + Number(amount)) * 100) / 100;
    await tx.wallet.update({ where: { id: wallet.id }, data: { balance: newBalance } });
    return tx.walletTransaction.create({
      data: {
        walletId: wallet.id,
        type: 'TOPUP',
        amount: Number(amount),
        balanceAfter: newBalance,
        notes: notes || null,
      },
    });
  });

  res.status(201).json(result);
});

// Moves balance from a parent's wallet straight down to one of its direct
// children in the hierarchy (e.g. Distributor L1 -> its Distributor L2).
// Deliberately restricted to parent->child so wallet flow always matches
// the distribution structure — no arbitrary wallet-to-wallet transfers.
app.post('/api/wallets/:customerId/transfer', requireAuth, async (req: Request, res: Response) => {
  const { toCustomerId, amount, notes } = req.body ?? {};
  if (!toCustomerId || !amount || Number(amount) <= 0) {
    return res.status(400).json({ error: 'Destination customer and a positive amount are required' });
  }
  if (toCustomerId === req.params.customerId) {
    return res.status(400).json({ error: 'Cannot transfer a wallet to itself' });
  }

  const toCustomer = await prisma.customer.findUnique({ where: { id: toCustomerId } });
  if (!toCustomer) return res.status(404).json({ error: 'Destination customer not found' });
  if (toCustomer.parentCustomerId !== req.params.customerId) {
    return res.status(400).json({ error: 'Wallet transfers can only go to a direct child in the hierarchy' });
  }

  try {
    const result = await prisma.$transaction(async (tx) => {
      const fromWallet = await tx.wallet.upsert({
        where: { customerId: req.params.customerId },
        create: { customerId: req.params.customerId, balance: 0 },
        update: {},
      });
      if (Number(fromWallet.balance) < Number(amount) - 0.01) {
        throw new Error(`Insufficient balance: wallet has ₹${Number(fromWallet.balance).toFixed(2)}, tried to send ₹${Number(amount).toFixed(2)}`);
      }
      const toWallet = await tx.wallet.upsert({
        where: { customerId: toCustomerId },
        create: { customerId: toCustomerId, balance: 0 },
        update: {},
      });

      const fromNewBalance = Math.round((Number(fromWallet.balance) - Number(amount)) * 100) / 100;
      const toNewBalance = Math.round((Number(toWallet.balance) + Number(amount)) * 100) / 100;

      await tx.wallet.update({ where: { id: fromWallet.id }, data: { balance: fromNewBalance } });
      await tx.wallet.update({ where: { id: toWallet.id }, data: { balance: toNewBalance } });

      const outTxn = await tx.walletTransaction.create({
        data: { walletId: fromWallet.id, type: 'TRANSFER_OUT', amount: Number(amount), balanceAfter: fromNewBalance, referenceType: 'TRANSFER', notes: notes || null },
      });
      await tx.walletTransaction.create({
        data: { walletId: toWallet.id, type: 'TRANSFER_IN', amount: Number(amount), balanceAfter: toNewBalance, referenceType: 'TRANSFER', referenceId: outTxn.id, notes: notes || null },
      });

      return outTxn;
    });

    res.status(201).json(result);
  } catch (err: any) {
    res.status(400).json({ error: err.message || 'Could not complete transfer' });
  }
});

// ── Dashboard ──────────────────────────────────────────
// Computes everything the dashboard needs in one call. At this data scale
// (hundreds/low-thousands of invoices) pulling the rows and aggregating in
// JS is simpler and plenty fast — worth revisiting with SQL aggregates if
// the invoice count grows much larger.
app.get('/api/dashboard', requireAuth, async (_req: Request, res: Response) => {
  const invoices = await prisma.invoice.findMany({
    where: { status: { not: 'CANCELLED' } },
    include: { customer: true },
  });
  const allPayments = await prisma.payment.findMany({
    include: { customer: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });
  const recentInvoices = await prisma.invoice.findMany({
    include: { customer: true },
    orderBy: { createdAt: 'desc' },
    take: 5,
  });

  const today = new Date();
  let totalSales = 0, amountReceived = 0, gstCollected = 0;
  let unpaidCount = 0, overdueCount = 0, overdueAmount = 0;
  const outstandingByCustomer = new Map<string, { name: string; outstanding: number }>();
  const monthlyRevenue = new Map<string, number>();

  for (const inv of invoices) {
    const total = Number(inv.totalValue);
    const paid = Number(inv.amountPaid);
    const outstanding = total - paid;
    const gst = Number(inv.cgstAmount) + Number(inv.sgstAmount) + Number(inv.igstAmount);

    totalSales += total;
    amountReceived += paid;
    gstCollected += gst;

    const monthKey = new Date(inv.invoiceDate).toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    monthlyRevenue.set(monthKey, (monthlyRevenue.get(monthKey) || 0) + total);

    if (outstanding > 0.01) {
      unpaidCount++;
      const isOverdue = new Date(inv.dueDate) < today;
      if (isOverdue) { overdueCount++; overdueAmount += outstanding; }

      const name = inv.customer.displayName || inv.customer.companyName || inv.customer.name;
      const entry = outstandingByCustomer.get(inv.customerId) || { name, outstanding: 0 };
      entry.outstanding += outstanding;
      outstandingByCustomer.set(inv.customerId, entry);
    }
  }

  const topOutstandingCustomers = [...outstandingByCustomer.values()]
    .sort((a, b) => b.outstanding - a.outstanding)
    .slice(0, 5);

  // Last 6 months, oldest to newest, zero-filled for months with no invoices
  const monthlyRevenueSeries = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
    const key = d.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
    monthlyRevenueSeries.push({ month: key, amount: Math.round((monthlyRevenue.get(key) || 0) * 100) / 100 });
  }

  res.json({
    totalSales: Math.round(totalSales * 100) / 100,
    amountReceived: Math.round(amountReceived * 100) / 100,
    outstandingAmount: Math.round((totalSales - amountReceived) * 100) / 100,
    overdueAmount: Math.round(overdueAmount * 100) / 100,
    gstCollected: Math.round(gstCollected * 100) / 100,
    unpaidInvoiceCount: unpaidCount,
    overdueInvoiceCount: overdueCount,
    monthlyRevenue: monthlyRevenueSeries,
    topOutstandingCustomers,
    recentInvoices,
    recentPayments: allPayments,
  });
});

app.listen(PORT, () => {
  console.log(`MNR Invoicing app running — open http://localhost:${PORT} in your browser`);
});
