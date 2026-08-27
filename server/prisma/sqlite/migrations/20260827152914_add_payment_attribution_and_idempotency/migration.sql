-- Additive only: two nullable columns and one index. No table is redefined,
-- so nothing can be lost if this is interrupted — see the comment on
-- Payment.recordedByStaffId in models.prisma for why the staff link is a bare
-- column rather than a foreign key. Prisma's default for a relation there was
-- RedefineTables (DROP TABLE "Payment"), which on the shop PC's
-- transaction-less migration runner would destroy the ledger on a crash.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "clientRequestId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "recordedByStaffId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_clientRequestId_key" ON "Payment"("clientRequestId");

