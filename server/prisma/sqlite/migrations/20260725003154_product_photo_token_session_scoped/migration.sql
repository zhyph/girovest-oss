/*
  Warnings:

  - You are about to drop the column `productId` on the `ProductPhotoToken` table. All the data in the column will be lost.
  - You are about to drop the column `usedAt` on the `ProductPhotoToken` table. All the data in the column will be lost.
  - Added the required column `locationId` to the `ProductPhotoToken` table without a default value. This is not possible if the table is not empty.
  - Added the required column `staffId` to the `ProductPhotoToken` table without a default value. This is not possible if the table is not empty.

*/
-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_ProductPhotoToken" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "staffId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProductPhotoToken_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "Staff" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductPhotoToken_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_ProductPhotoToken" ("createdAt", "expiresAt", "id", "token") SELECT "createdAt", "expiresAt", "id", "token" FROM "ProductPhotoToken";
DROP TABLE "ProductPhotoToken";
ALTER TABLE "new_ProductPhotoToken" RENAME TO "ProductPhotoToken";
CREATE UNIQUE INDEX "ProductPhotoToken_token_key" ON "ProductPhotoToken"("token");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
