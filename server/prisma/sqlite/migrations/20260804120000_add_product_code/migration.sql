-- Nullable on purpose, and left empty here on purpose.
--
-- The column is added blank and filled by productBackfill.ts at server
-- startup, NOT by an UPDATE in this file. Two reasons, both load-bearing:
-- the Postgres deployment path does not run this directory at all (its own
-- migrations are generated separately and assume empty tables), so a
-- backfill written here would only ever cover SQLite; and a per-location
-- ROW_NUMBER() backfill in raw SQL would have to be written twice, once per
-- dialect, and kept in step with the numbering rule productService uses for
-- new pieces. contractBackfill.ts established this pattern for exactly this
-- situation — see its header.
--
-- A NOT NULL column was not an option either: the unique index below would
-- reject a shared placeholder default the moment a shop had two pieces.
-- Both SQLite and Postgres allow repeated NULLs under a unique index, so
-- the constraint holds from the first day while the backfill catches up.
ALTER TABLE "Product" ADD COLUMN "code" INTEGER;

CREATE UNIQUE INDEX "Product_locationId_code_key" ON "Product"("locationId", "code");
