/**
 * E-Invoicing Service — Masters India GSP integration
 *
 * Flow:
 *  1. Build the government-mandated JSON payload from the invoice record
 *  2. Authenticate with Masters India API to get a bearer token
 *  3. POST the payload to Masters India's /einvoice/generate endpoint
 *  4. Receive IRN + QR Code + Ack Number back and persist to DB
 *
 * Masters India sandbox: https://commonapi.mastersindia.co (sandbox)
 * Masters India prod:    https://commonapi.mastersindia.co (same domain, different credentials)
 *
 * Reference: https://docs.mastersindia.co/e-invoice
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ── Masters India API config ──────────────────────────────────────────────
const MI_BASE_URL = process.env.MI_BASE_URL || 'https://commonapi.mastersindia.co';
const MI_CLIENT_ID = process.env.MI_CLIENT_ID || '';
const MI_CLIENT_SECRET = process.env.MI_CLIENT_SECRET || '';

// ── UOM code mapping (government-mandated codes) ──────────────────────────
// Masters India / IRP accepts a fixed set of UOM codes.
// Map your internal unit strings to the IRP standard codes.
const UOM_MAP: Record<string, string> = {
  NOS: 'NOS',
  nos: 'NOS',
  PCS: 'PCS',
  pcs: 'PCS',
  KGS: 'KGS',
  kgs: 'KGS',
  MTR: 'MTR',
  mtr: 'MTR',
  LTR: 'LTR',
  ltr: 'LTR',
  BOX: 'BOX',
  box: 'BOX',
  OTH: 'OTH',
};
function toIrpUom(unit: string): string {
  return UOM_MAP[unit] || 'OTH';
}

// ── Supply type codes ──────────────────────────────────────────────────────
// B2B: registered buyer, EXPWP: export with payment, EXPWOP: without payment
// For MNR (domestic B2B only), we always use B2B.
const SUPPLY_TYPE = 'B2B';
const DOC_TYPE = 'INV'; // INV | CRN | DBN

// ── Step 1: Get Masters India OAuth token ─────────────────────────────────
let _tokenCache: { token: string; expiresAt: number } | null = null;

async function getMiToken(apiKey: string, username: string, password: string): Promise<string> {
  // Return cached token if still valid (with 60s safety margin)
  if (_tokenCache && Date.now() < _tokenCache.expiresAt - 60_000) {
    return _tokenCache.token;
  }

  const res = await fetch(`${MI_BASE_URL}/commonapi/v1.0/authenticate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'gstin': '',         // Not needed for token, but required header on some endpoints
      'client_id': MI_CLIENT_ID || apiKey,
      'client_secret': MI_CLIENT_SECRET,
    },
    body: JSON.stringify({ username, password }),
  });

  if (!res.ok) {
    const err: any = await res.json().catch(() => ({}));
    throw new Error(`Masters India auth failed: ${err?.message || res.statusText}`);
  }

  const data: any = await res.json();
  if (!data?.data?.authToken) {
    throw new Error('Masters India auth: no authToken in response');
  }

  // Masters India tokens expire in ~6 hours; cache for 5h 55m to be safe
  _tokenCache = {
    token: data.data.authToken,
    expiresAt: Date.now() + (5 * 60 + 55) * 60 * 1000,
  };
  return _tokenCache.token;
}

// ── Step 2: Build the IRP JSON payload ───────────────────────────────────
// The government schema requires very specific field names. This function
// maps your DB fields to the required structure.
function buildIrpPayload(invoice: any, company: any, customer: any): any {
  const sellerGstin = company.gstin || '';
  const buyerGstin = customer.gstin || '';
  const isExport = !buyerGstin; // no GSTIN = likely unregistered/consumer

  // Determine supply type
  const supplyType = isExport ? 'B2C' : 'B2B';

  // Address helper
  const sellerAddr = {
    Addr1: company.registeredAddress || 'NA',
    Loc: company.city || 'NA',
    Pin: parseInt(company.pincode || '000000'),
    Stcd: company.stateCode || sellerGstin.slice(0, 2),
  };

  const buyerAddr = (() => {
    const addr = (customer.addresses || []).find((a: any) => a.type === 'BILLING') ||
                 (customer.addresses || [])[0];
    return {
      Addr1: addr?.line1 || 'NA',
      Loc: addr?.city || customer.state || 'NA',
      Pin: parseInt(addr?.pincode || '000000'),
      Stcd: customer.stateCode || buyerGstin.slice(0, 2) || '00',
    };
  })();

  // Line items
  const itemList = (invoice.items || []).map((item: any, idx: number) => {
    const taxableVal = Number(item.taxableValue);
    const cgst = Number(item.cgstAmount);
    const sgst = Number(item.sgstAmount);
    const igst = Number(item.igstAmount);
    const gstRt = Number(item.taxRatePct);
    const lineTotal = Number(item.lineTotal);

    return {
      SlNo: String(idx + 1),
      PrdDesc: item.description.slice(0, 300), // IRP max 300 chars
      IsServc: 'Y',                             // ISP = internet service provider, always service
      HsnCd: item.hsnSac || '998422',           // Telecom/internet SAC code as fallback
      Qty: Number(item.quantity),
      Unit: toIrpUom(item.unit || 'NOS'),
      UnitPrice: Number(item.rate),
      TotAmt: Number(item.rate) * Number(item.quantity),
      Discount: Number(item.discountPct) > 0
        ? (Number(item.rate) * Number(item.quantity) * Number(item.discountPct)) / 100
        : 0,
      PreTaxVal: taxableVal,
      AssAmt: taxableVal,
      GstRt: gstRt,
      IgstAmt: igst,
      CgstAmt: cgst,
      SgstAmt: sgst,
      CesRt: 0,
      CesAmt: 0,
      CesNonAdvlAmt: 0,
      StateCesRt: 0,
      StateCesAmt: 0,
      StateCesNonAdvlAmt: 0,
      OthChrg: 0,
      TotItemVal: lineTotal,
    };
  });

  // Invoice totals
  const valDtls = {
    AssVal: Number(invoice.taxableValue),
    CgstVal: Number(invoice.cgstAmount),
    SgstVal: Number(invoice.sgstAmount),
    IgstVal: Number(invoice.igstAmount),
    CesVal: 0,
    StCesVal: 0,
    Discount: Number(invoice.discountTotal || 0),
    OthChrg: Number(invoice.otherCharges || 0),
    RndOffAmt: Number(invoice.roundOff || 0),
    TotInvVal: Number(invoice.totalValue),
    TotInvValFc: 0,
  };

  const invoiceDateFormatted = new Date(invoice.invoiceDate)
    .toLocaleDateString('en-GB')
    .split('/')
    .join('/'); // DD/MM/YYYY

  const payload = {
    Version: '1.1',
    TranDtls: {
      TaxSch: 'GST',
      SupTyp: supplyType,
      RegRev: 'N',
      EcmGstin: null,
      IgstOnIntra: 'N',
    },
    DocDtls: {
      Typ: DOC_TYPE,
      No: invoice.invoiceNumber,
      Dt: invoiceDateFormatted,
    },
    SellerDtls: {
      Gstin: sellerGstin,
      LglNm: company.legalName || company.name,
      TrdNm: company.name,
      Addr1: sellerAddr.Addr1,
      Loc: sellerAddr.Loc,
      Pin: sellerAddr.Pin,
      Stcd: sellerAddr.Stcd,
      Ph: company.contactPhone || '',
      Em: company.contactEmail || '',
    },
    BuyerDtls: {
      Gstin: buyerGstin || 'URP', // 'URP' = Unregistered Person
      LglNm: customer.displayName || customer.companyName || customer.name,
      TrdNm: customer.companyName || customer.name,
      Pos: customer.stateCode || '00',
      Addr1: buyerAddr.Addr1,
      Loc: buyerAddr.Loc,
      Pin: buyerAddr.Pin,
      Stcd: buyerAddr.Stcd,
      Ph: '',
      Em: '',
    },
    ItemList: itemList,
    ValDtls: valDtls,
  };

  return payload;
}

// ── Step 3: Generate IRN ──────────────────────────────────────────────────
export async function generateIrn(invoiceId: string): Promise<{
  irn: string;
  ackNumber: string;
  ackDate: Date;
  qrCode: string;
}> {
  // Load full invoice with items, customer addresses, and company
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      items: { include: { productService: true } },
      customer: { include: { addresses: true } },
      company: true,
    },
  });

  if (!invoice) throw new Error('Invoice not found');
  if (invoice.status === 'DRAFT') throw new Error('Cannot generate IRN for a draft invoice. Finalize it first.');
  if (invoice.irn) throw new Error('IRN already generated for this invoice');
  if (!invoice.invoiceNumber) throw new Error('Invoice has no invoice number — finalize it first');

  const company = invoice.company;
  const customer = invoice.customer;

  // ── Mock Mode Fallback ──────────────────────────────────────────────────
  if (process.env.MOCK_EINVOICE === 'true') {
    const mockIrn = require('crypto').randomBytes(32).toString('hex');
    const mockAckNo = String(Math.floor(100000000000 + Math.random() * 900000000000));
    const mockAckDate = new Date();
    // Tiny black & white QR code base64
    const mockQr = 'iVBORw0KGgoAAAANSUhEUgAAAQAAAAEAAQMAAABb/GLDAAAABlBMVEX///8AAABVwtN+AAAACXBIWXMAAAsTAAALEwEAmpwYAAAAB3RJTUUH5QgKCg0XNz44jwAAAZNJREFUeJzt2cGNwzAMQFFhE/4/W3gLp4B0AC1AD7AFVIGswD3sAl5gG/ACe4BtYAvYA6QFWQFpwP2f0/d4lOQ2P2GSR+t8gEcePeADPPKAD/DoA48+8OgDjz7w6AO/7eC3Hzx+2sFvO/gQDr6Hgw/h4EM4+BAO/sVpB7894LcH/PaA3x7w2wP+xWkHvz3gQzj4EA4+hIMP4eBffP4OfnvAh3DwIRx8CAcfwsG/+E9v9vP+Hfy2gw/h4EM4+BAO/sXf7eADPPKAD/DoA48+8OgDjz7w6AO/7eC3Hzx+2sFvO/hQDr6Hgw/h4EM4+BAO/sVpB7894LcH/PaA3x7w2wP+xWkHvz3gQzj4EA4+hIMP4eBffP4OfnvAh3DwIRx8CAcfwsG/+E9v9vP+Hfy2gw/h4EM4+BAO/sXf7eADPPrApw/8AwAA//8DAO36B2jMewUAAAAASUVORK5CYII=';

    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        irn: mockIrn,
        irnAckNumber: mockAckNo,
        irnAckDate: mockAckDate,
        eInvoiceQrCode: mockQr,
        eInvoiceStatus: 'GENERATED',
      },
    });

    return {
      irn: mockIrn,
      ackNumber: mockAckNo,
      ackDate: mockAckDate,
      qrCode: mockQr,
    };
  }

  // Validate company e-invoicing config
  if (!company.eInvoicingEnabled) throw new Error('E-Invoicing is not enabled for this company');
  if (!company.irpApiKey) throw new Error('Masters India API key not configured in Settings');
  if (!company.irpUsername || !company.irpPassword) {
    throw new Error('IRP username/password not configured in Settings');
  }
  if (!company.gstin) throw new Error('Company GSTIN is required for e-invoicing');

  // Only generate IRN if invoice has GST
  const hasTax = Number(invoice.cgstAmount) + Number(invoice.sgstAmount) + Number(invoice.igstAmount) > 0;
  if (!hasTax) {
    throw new Error('This invoice has no GST — IRN is not required for zero-tax invoices');
  }

  // Mark as PENDING first so we can detect failures
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: { eInvoiceStatus: 'PENDING' },
  });

  let authToken: string;
  try {
    authToken = await getMiToken(company.irpApiKey, company.irpUsername, company.irpPassword);
  } catch (err: any) {
    await prisma.invoice.update({ where: { id: invoiceId }, data: { eInvoiceStatus: 'FAILED' } });
    throw new Error(`Authentication failed: ${err.message}`);
  }

  const payload = buildIrpPayload(invoice, company, customer);

  // Call Masters India e-invoice generation API
  const apiRes = await fetch(`${MI_BASE_URL}/commonapi/v1.0/einvoice/generate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      'gstin': company.gstin,
    },
    body: JSON.stringify(payload),
  });

  const apiData: any = await apiRes.json();

  // Masters India returns { success: true, data: { Irn, AckNo, AckDt, SignedQRCode, ... } }
  if (!apiRes.ok || !apiData?.data?.Irn) {
    const errorMsg = apiData?.error?.[0]?.ErrorMessage || apiData?.message || 'Unknown IRP error';
    await prisma.invoice.update({ where: { id: invoiceId }, data: { eInvoiceStatus: 'FAILED' } });
    throw new Error(`IRP Error: ${errorMsg}`);
  }

  const { Irn, AckNo, AckDt, SignedQRCode } = apiData.data;
  const ackDate = new Date(AckDt);

  // Persist IRN to DB
  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      irn: Irn,
      irnAckNumber: String(AckNo),
      irnAckDate: ackDate,
      eInvoiceQrCode: SignedQRCode,
      eInvoiceStatus: 'GENERATED',
    },
  });

  return {
    irn: Irn,
    ackNumber: String(AckNo),
    ackDate,
    qrCode: SignedQRCode,
  };
}

// ── Step 4: Cancel IRN ────────────────────────────────────────────────────
// IRN can only be cancelled within 24 hours of generation at the IRP.
// Cancel reason codes: 1 = Duplicate, 2 = Data Entry Mistake, 3 = Order Cancelled, 4 = Other
export async function cancelIrn(
  invoiceId: string,
  cancelReasonCode: 1 | 2 | 3 | 4,
  cancelReason: string
): Promise<void> {
  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { company: true },
  });

  if (!invoice) throw new Error('Invoice not found');
  if (!invoice.irn) throw new Error('This invoice has no IRN to cancel');
  if (invoice.eInvoiceStatus === 'CANCELLED') throw new Error('IRN already cancelled');

  // ── Mock Mode Fallback ──────────────────────────────────────────────────
  if (process.env.MOCK_EINVOICE === 'true') {
    await prisma.invoice.update({
      where: { id: invoiceId },
      data: {
        eInvoiceStatus: 'CANCELLED',
        irnCancelledAt: new Date(),
        irnCancelReason: cancelReason,
      },
    });
    return;
  }

  const company = invoice.company;
  if (!company.irpApiKey || !company.irpUsername || !company.irpPassword || !company.gstin) {
    throw new Error('IRP credentials not configured');
  }

  // Check 24-hour window
  const ackDate = invoice.irnAckDate;
  if (ackDate) {
    const hoursSinceGeneration = (Date.now() - ackDate.getTime()) / (1000 * 60 * 60);
    if (hoursSinceGeneration > 24) {
      throw new Error('IRN can only be cancelled within 24 hours of generation. Contact your GST consultant for manual cancellation.');
    }
  }

  const authToken = await getMiToken(company.irpApiKey, company.irpUsername, company.irpPassword);

  const cancelPayload = {
    Irn: invoice.irn,
    CnlRsn: cancelReasonCode,
    CnlRem: cancelReason.slice(0, 100),
  };

  const apiRes = await fetch(`${MI_BASE_URL}/commonapi/v1.0/einvoice/cancel`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`,
      'gstin': company.gstin,
    },
    body: JSON.stringify(cancelPayload),
  });

  const apiData: any = await apiRes.json();

  if (!apiRes.ok || apiData?.success === false) {
    const errorMsg = apiData?.error?.[0]?.ErrorMessage || apiData?.message || 'Unknown IRP error';
    throw new Error(`IRP Cancel Error: ${errorMsg}`);
  }

  await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      eInvoiceStatus: 'CANCELLED',
      irnCancelledAt: new Date(),
      irnCancelReason: cancelReason,
    },
  });
}
