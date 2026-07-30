-- CreateTable
CREATE TABLE "RelayIdempotencyKey" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "key" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Location" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'pt-BR',
    "phone" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "maintenanceBufferDays" INTEGER NOT NULL DEFAULT 0,
    "connectivityMode" TEXT NOT NULL DEFAULT 'lan'
);
INSERT INTO "new_Location" ("address", "createdAt", "id", "locale", "maintenanceBufferDays", "name", "phone") SELECT "address", "createdAt", "id", "locale", "maintenanceBufferDays", "name", "phone" FROM "Location";
DROP TABLE "Location";
ALTER TABLE "new_Location" RENAME TO "Location";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "RelayIdempotencyKey_key_key" ON "RelayIdempotencyKey"("key");
