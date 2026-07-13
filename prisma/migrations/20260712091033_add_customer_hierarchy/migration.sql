-- CreateEnum
CREATE TYPE "CustomerTier" AS ENUM ('DISTRIBUTOR_L1', 'DISTRIBUTOR_L2', 'PARTNER', 'CUSTOMER');

-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "parent_customer_id" TEXT,
ADD COLUMN     "tier" "CustomerTier" NOT NULL DEFAULT 'CUSTOMER';

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_parent_customer_id_fkey" FOREIGN KEY ("parent_customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
