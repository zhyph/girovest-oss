-- See the sqlite twin of this migration for why the column is nullable and
-- why nothing backfills it here: productBackfill.ts fills it at startup, on
-- both providers.
-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "code" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "Product_locationId_code_key" ON "Product"("locationId", "code");
