-- Additive only: two nullable columns and one index. No table is redefined,
-- so nothing can be lost if this is interrupted — see the comment on
-- Payment.recordedByStaffId in models.prisma for why the staff link is a bare
-- column rather than a foreign key.

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "clientRequestId" TEXT;
ALTER TABLE "Payment" ADD COLUMN "recordedByStaffId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Payment_clientRequestId_key" ON "Payment"("clientRequestId");
