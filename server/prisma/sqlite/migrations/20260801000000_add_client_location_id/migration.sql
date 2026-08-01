-- Invariant guard: refuse to proceed if more than one Location row exists.
-- Zero or one rows are both fine — Client is necessarily empty when
-- Location is empty (client creation requires an authenticated Staff,
-- which requires a Location) — only more than one is unsafe, since the
-- backfill below has no way to pick the "right" one.
--
-- RAISE() only works inside a SQLite trigger body, not as a plain
-- statement, hence the scratch table/trigger. Cleanup runs at BOTH ends:
-- an idempotent DROP first (in case a previous aborted attempt at this
-- exact migration left debris — this script has no wrapping transaction,
-- so an abort partway leaves everything run so far committed), and a real
-- DROP after the guard passes (this second DROP only executes on success;
-- an abort never reaches it, which is fine, because the NEXT attempt's
-- leading DROP cleans it up then).
DROP TRIGGER IF EXISTS "_location_scoping_guard_trigger";
DROP TABLE IF EXISTS "_location_scoping_guard";

CREATE TABLE "_location_scoping_guard" ("id" INTEGER PRIMARY KEY CHECK ("id" = 1));

CREATE TRIGGER "_location_scoping_guard_trigger"
BEFORE INSERT ON "_location_scoping_guard"
WHEN (SELECT COUNT(*) FROM "Location") > 1
BEGIN
  SELECT RAISE(ABORT, 'add_client_location_id: more than one Location row exists; refusing to backfill Client.locationId. This is not a transient failure — restoring a backup will not fix it. Contact support.');
END;

INSERT INTO "_location_scoping_guard" ("id") VALUES (1);

DROP TRIGGER "_location_scoping_guard_trigger";
DROP TABLE "_location_scoping_guard";

-- Add the column nullable first (SQLite can't add a NOT NULL column with no
-- default to a non-empty table in one step).
ALTER TABLE "Client" ADD COLUMN "locationId" TEXT;

-- Backfill: the guard above already proved at most one Location row exists.
UPDATE "Client" SET "locationId" = (SELECT "id" FROM "Location" LIMIT 1);

-- Rebuild the table to make the column NOT NULL with its FK constraint.
-- PRAGMA foreign_keys=OFF is required outside a transaction for this
-- DROP+RENAME sequence not to cascade-delete ClientIdentityDocument/
-- ClientAddressLine rows (both ON DELETE CASCADE to Client).
PRAGMA foreign_keys=OFF;

CREATE TABLE "new_Client" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "locationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Client_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Client" ("id", "locationId", "name", "phone", "email", "notes", "createdAt")
SELECT "id", "locationId", "name", "phone", "email", "notes", "createdAt" FROM "Client";
DROP TABLE "Client";
ALTER TABLE "new_Client" RENAME TO "Client";

PRAGMA foreign_keys=ON;
