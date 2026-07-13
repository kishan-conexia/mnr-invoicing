# MNR Broadband Invoicing — Phase 4: Database Layer

This delivers the Prisma schema, seed data, and migration tooling described in Phase 4
of the architecture document. No application code yet — this is the database foundation
Phase 5 (backend APIs) will build on.

## What's here
- `prisma/schema.prisma` — full normalized schema: org/access, customers, catalogue,
  sales documents (invoice/quotation/proforma), payments & allocations, credit/debit
  notes, double-entry ledger (`chart_of_accounts` + `ledger_entries` +
  `customer_ledger_entries`), and operations tables (follow-ups, notifications,
  attachments, email/reminder logs, approvals, audit log, settings).
- `prisma/seed.ts` — creates the company, financial year 2026-27, number sequences,
  the 8 standard roles with a sane default permission matrix, a starter chart of
  accounts, GST tax rates, 2 sample users, 5 sample services, and 2 sample customers.
- `.env.example` — copy to `.env` and point at your Postgres instance.

## Setup (run in your own environment — this sandbox has no live database or network access)

```bash
npm install
cp .env.example .env
# edit .env with your real DATABASE_URL

npx prisma migrate dev --name init   # creates prisma/migrations/ and applies to your DB
npm run seed                         # loads sample data
npx prisma studio                    # optional: browse the data visually
```

`prisma migrate dev` is what actually generates the SQL migration files — that step
needs a live Postgres connection, which is why the migration isn't included here. Once
you run it once, commit the generated `prisma/migrations/` folder to version control;
all future runs use `prisma migrate deploy` in CI/production.

## Design notes carried over from the architecture doc
- Every money column is `Decimal`, never float.
- `ledger_entries` is the only place double-entry postings are written — Phase 5's
  `LedgerService` will be the single writer, enforced at the application layer.
- `payment_allocations` is the join table that makes partial/advance/multi-invoice
  payments work: a payment settles N invoices, an invoice can be settled by N payments.
- `number_sequences` is scoped per (company, financial year, document type) so invoice/
  credit-note/receipt numbering all reset independently at financial-year rollover.
- Financial-chain foreign keys default to `RESTRICT`, not `CASCADE` — nothing
  accounting-related silently disappears when a parent row is removed.
- `deleted_at` (soft delete) is on `User` and `Customer`; invoices are never hard- or
  soft-deleted — they're cancelled in place per the business rules.

## Before Phase 5
Confirm the open items from the architecture doc (§1.2) — particularly whether
e-invoicing/IRN and TDS reconciliation are in scope — since both would add tables/columns
here (`irn`, `qr_code_data`, `ack_number` on `invoices`; a `tds_reconciliations` table)
that are cheaper to add now than after the API layer is built on top.

## Next: Phase 5
Backend APIs (NestJS modules), the GST calculation + rounding engine, the
`LedgerService` transaction logic, the recurring billing job, and PDF/Excel generation.
