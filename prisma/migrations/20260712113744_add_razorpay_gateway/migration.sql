-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "razorpay_key_id" TEXT,
ADD COLUMN     "razorpay_key_secret" TEXT;

-- CreateTable
CREATE TABLE "gateway_topup_orders" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "razorpay_order_id" TEXT NOT NULL,
    "razorpay_payment_id" TEXT,
    "status" TEXT NOT NULL DEFAULT 'CREATED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paid_at" TIMESTAMP(3),

    CONSTRAINT "gateway_topup_orders_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "gateway_topup_orders_razorpay_order_id_key" ON "gateway_topup_orders"("razorpay_order_id");

-- CreateIndex
CREATE INDEX "gateway_topup_orders_customer_id_status_idx" ON "gateway_topup_orders"("customer_id", "status");

-- AddForeignKey
ALTER TABLE "gateway_topup_orders" ADD CONSTRAINT "gateway_topup_orders_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
