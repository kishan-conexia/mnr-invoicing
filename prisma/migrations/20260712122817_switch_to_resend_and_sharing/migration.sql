/*
  Warnings:

  - A unique constraint covering the columns `[share_token]` on the table `invoices` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "resend_api_key" TEXT,
ADD COLUMN     "resend_from_email" TEXT,
ADD COLUMN     "resend_from_name" TEXT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "share_token" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "invoices_share_token_key" ON "invoices"("share_token");
