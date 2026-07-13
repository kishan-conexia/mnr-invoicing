/*
  Warnings:

  - A unique constraint covering the columns `[portal_email]` on the table `customers` will be added. If there are existing duplicate values, this will fail.

*/
-- AlterTable
ALTER TABLE "customers" ADD COLUMN     "portal_email" TEXT,
ADD COLUMN     "portal_password_hash" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "customers_portal_email_key" ON "customers"("portal_email");
