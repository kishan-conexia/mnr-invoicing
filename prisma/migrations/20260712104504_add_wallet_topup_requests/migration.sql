-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "issued_by_customer_id" TEXT;

-- CreateTable
CREATE TABLE "wallet_topup_requests" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewed_at" TIMESTAMP(3),
    "reviewed_by_id" TEXT,

    CONSTRAINT "wallet_topup_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wallet_topup_requests_customer_id_status_idx" ON "wallet_topup_requests"("customer_id", "status");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_customer_id_fkey" FOREIGN KEY ("issued_by_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_topup_requests" ADD CONSTRAINT "wallet_topup_requests_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wallet_topup_requests" ADD CONSTRAINT "wallet_topup_requests_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
