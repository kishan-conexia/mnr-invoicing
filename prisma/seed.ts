import { PrismaClient, BillingCycle } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const ROLES = [
  { name: 'Super Admin', isSystem: true },
  { name: 'Admin', isSystem: true },
  { name: 'Accounts Manager', isSystem: true },
  { name: 'Accountant', isSystem: true },
  { name: 'Sales Executive', isSystem: true },
  { name: 'Collection Executive', isSystem: true },
  { name: 'Viewer', isSystem: true },
  { name: 'Auditor', isSystem: true },
];

// resource:action pairs. Super Admin gets every permission; others get a sane subset below.
const PERMISSIONS: Array<[string, string]> = [
  ['invoice', 'view'], ['invoice', 'create'], ['invoice', 'edit'], ['invoice', 'delete'],
  ['invoice', 'cancel'], ['invoice', 'approve'], ['invoice', 'send'], ['invoice', 'export'],
  ['invoice', 'change_tax'], ['invoice', 'change_number'],
  ['payment', 'view'], ['payment', 'create'], ['payment', 'edit'], ['payment', 'delete'],
  ['customer', 'view'], ['customer', 'create'], ['customer', 'edit'], ['customer', 'delete'],
  ['report', 'view_financial'], ['report', 'export'],
  ['credit_note', 'create'], ['credit_note', 'approve'],
  ['debit_note', 'create'], ['debit_note', 'approve'],
  ['user', 'manage'], ['role', 'manage'], ['settings', 'manage'],
  ['audit_log', 'view'],
];

const ROLE_PERMISSION_MAP: Record<string, Array<[string, string]>> = {
  Admin: PERMISSIONS,
  'Accounts Manager': PERMISSIONS.filter(([r]) => r !== 'user' && r !== 'role'),
  Accountant: [
    ['invoice', 'view'], ['invoice', 'create'], ['invoice', 'edit'], ['invoice', 'send'],
    ['payment', 'view'], ['payment', 'create'], ['payment', 'edit'],
    ['customer', 'view'], ['customer', 'create'], ['customer', 'edit'],
    ['credit_note', 'create'], ['debit_note', 'create'],
    ['report', 'view_financial'], ['report', 'export'],
  ],
  'Sales Executive': [
    ['customer', 'view'], ['customer', 'create'], ['customer', 'edit'],
    ['invoice', 'view'], ['invoice', 'create'], ['invoice', 'send'],
  ],
  'Collection Executive': [
    ['customer', 'view'], ['invoice', 'view'], ['payment', 'view'], ['payment', 'create'],
  ],
  Viewer: [
    ['invoice', 'view'], ['customer', 'view'], ['payment', 'view'], ['report', 'view_financial'],
  ],
  Auditor: [
    ['invoice', 'view'], ['customer', 'view'], ['payment', 'view'],
    ['report', 'view_financial'], ['audit_log', 'view'],
  ],
};

const CHART_OF_ACCOUNTS = [
  { code: '1100', name: 'Accounts Receivable', accountType: 'ASSET' },
  { code: '1000', name: 'Bank', accountType: 'ASSET' },
  { code: '1001', name: 'Cash', accountType: 'ASSET' },
  { code: '4000', name: 'Sales - Broadband Services', accountType: 'INCOME' },
  { code: '2100', name: 'Output CGST', accountType: 'LIABILITY' },
  { code: '2101', name: 'Output SGST', accountType: 'LIABILITY' },
  { code: '2102', name: 'Output IGST', accountType: 'LIABILITY' },
  { code: '5900', name: 'Round Off', accountType: 'EXPENSE' },
  { code: '1101', name: 'TDS Receivable', accountType: 'ASSET' },
];

async function main() {
  console.log('Seeding MNR Broadband invoicing database...');

  const company = await prisma.company.create({
    data: {
      name: 'MNR Broadband Services Pvt. Ltd.',
      legalName: 'MNR Broadband Services Private Limited',
      gstin: '27AAAAA0000A1Z5',
      pan: 'AAAAA0000A',
      registeredAddress: 'Plot 12, Tech Park Road',
      city: 'Pune',
      state: 'Maharashtra',
      stateCode: '27',
      country: 'India',
      pincode: '411001',
      contactEmail: 'accounts@mnrbroadband.example',
      contactPhone: '+91-9000000000',
      bankDetails: {
        accountName: 'MNR Broadband Services Pvt. Ltd.',
        accountNumber: '000000000000',
        ifsc: 'HDFC0000000',
        bankName: 'HDFC Bank',
        branch: 'Pune Main',
      },
      termsAndConditions: 'Payment due within agreed credit terms. Interest applicable on overdue amounts as per contract.',
    },
  });

  const branch = await prisma.branch.create({
    data: { companyId: company.id, name: 'Head Office - Pune', gstin: company.gstin!, isActive: true },
  });

  const fy = await prisma.financialYear.create({
    data: {
      companyId: company.id,
      label: '2026-27',
      startDate: new Date('2026-04-01'),
      endDate: new Date('2027-03-31'),
      isCurrent: true,
    },
  });

  for (const docType of ['INVOICE', 'CREDIT_NOTE', 'DEBIT_NOTE', 'RECEIPT', 'QUOTATION', 'PROFORMA']) {
    await prisma.numberSequence.create({
      data: {
        companyId: company.id,
        financialYearId: fy.id,
        documentType: docType,
        prefix: docType === 'INVOICE' ? 'INV' : docType.slice(0, 3),
        lastNumber: 0,
      },
    });
  }

  // Roles + permissions
  const roleRecords: Record<string, { id: string }> = {};
  for (const r of ROLES) {
    roleRecords[r.name] = await prisma.role.create({ data: r });
  }

  const permRecords: Record<string, { id: string }> = {};
  for (const [resource, action] of PERMISSIONS) {
    const perm = await prisma.permission.create({ data: { resource, action } });
    permRecords[`${resource}:${action}`] = perm;
  }

  for (const [roleName, perms] of Object.entries(ROLE_PERMISSION_MAP)) {
    for (const [resource, action] of perms) {
      await prisma.rolePermission.create({
        data: { roleId: roleRecords[roleName].id, permissionId: permRecords[`${resource}:${action}`].id },
      });
    }
  }
  // Super Admin: everything
  for (const perm of Object.values(permRecords)) {
    await prisma.rolePermission.create({
      data: { roleId: roleRecords['Super Admin'].id, permissionId: perm.id },
    });
  }

  // Chart of accounts
  const coa: Record<string, { id: string }> = {};
  for (const acc of CHART_OF_ACCOUNTS) {
    coa[acc.code] = await prisma.chartOfAccount.create({ data: { ...acc, companyId: company.id } });
  }

  // Tax rates
  const gst18 = await prisma.taxRate.create({ data: { companyId: company.id, name: 'GST 18%', ratePct: 18 } });
  await prisma.taxRate.create({ data: { companyId: company.id, name: 'GST 12%', ratePct: 12 } });
  await prisma.taxRate.create({ data: { companyId: company.id, name: 'GST 0%', ratePct: 0 } });

  // Sample users
  const passwordHash = await bcrypt.hash('ChangeMe@123', 12);
  await prisma.user.create({
    data: {
      companyId: company.id,
      roleId: roleRecords['Super Admin'].id,
      name: 'System Administrator',
      email: 'admin@mnrbroadband.example',
      passwordHash,
    },
  });
  await prisma.user.create({
    data: {
      companyId: company.id,
      roleId: roleRecords['Accountant'].id,
      name: 'Priya Accountant',
      email: 'accounts@mnrbroadband.example',
      passwordHash,
    },
  });

  // Sample products/services
  const services = [
    { name: 'Broadband Connection - 100 Mbps', code: 'SVC-BB-100', hsnSac: '998422', standardRate: 999, billingFrequency: BillingCycle.MONTHLY },
    { name: 'Internet Leased Line - 100 Mbps', code: 'SVC-ILL-100', hsnSac: '998422', standardRate: 15000, billingFrequency: BillingCycle.MONTHLY },
    { name: 'Static IP', code: 'SVC-STATIC-IP', hsnSac: '998422', standardRate: 500, billingFrequency: BillingCycle.MONTHLY },
    { name: 'Router Charges', code: 'SVC-ROUTER', hsnSac: '998422', standardRate: 1500, billingFrequency: null },
    { name: 'Installation Charges', code: 'SVC-INSTALL', hsnSac: '998422', standardRate: 2000, billingFrequency: null },
  ];
  for (const s of services) {
    await prisma.productService.create({
      data: { ...s, companyId: company.id, taxRateId: gst18.id, unit: 'NOS' },
    });
  }

  // Sample customers
  await prisma.customer.create({
    data: {
      companyId: company.id,
      customerCode: 'CUST-0001',
      name: 'Rohan Sharma',
      displayName: 'Sharma Textiles Pvt. Ltd.',
      companyName: 'Sharma Textiles Pvt. Ltd.',
      gstin: '27BBBBB1111B1Z6',
      state: 'Maharashtra',
      stateCode: '27',
      category: 'SME',
      paymentTermsDays: 15,
      creditLimit: 50000,
      addresses: {
        create: [
          { type: 'BILLING', line1: 'Shop 4, MG Road', city: 'Pune', state: 'Maharashtra', stateCode: '27', pincode: '411001' },
          { type: 'INSTALLATION', line1: 'Shop 4, MG Road', city: 'Pune', state: 'Maharashtra', stateCode: '27', pincode: '411001' },
        ],
      },
      contacts: { create: [{ name: 'Rohan Sharma', mobile: '9876543210', email: 'rohan@sharmatextiles.example', isPrimary: true }] },
    },
  });

  await prisma.customer.create({
    data: {
      companyId: company.id,
      customerCode: 'CUST-0002',
      name: 'Ananya Enterprises',
      displayName: 'Ananya Enterprises',
      gstin: '29CCCCC2222C1Z7',
      state: 'Karnataka',
      stateCode: '29',
      category: 'Enterprise',
      paymentTermsDays: 30,
      creditLimit: 200000,
      addresses: {
        create: [{ type: 'BILLING', line1: 'Tower B, Whitefield', city: 'Bengaluru', state: 'Karnataka', stateCode: '29', pincode: '560066' }],
      },
    },
  });

  console.log('Seed complete.');
  console.log(`Company: ${company.name} (${company.id})`);
  console.log('Login: admin@mnrbroadband.example / ChangeMe@123 (change immediately)');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
