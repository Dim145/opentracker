-- Retire the catalogue-removals feed.
--
-- Replaced by signed tombstone records, which carry the same statement with a
-- proof attached and reconcile like any other record. Nothing reads this table
-- any more.
--
-- IF EXISTS because it may genuinely be absent: this is the one table
-- `drizzle-kit push` failed to create, on the failure that started the
-- migration work in the first place.
DROP TABLE IF EXISTS "federation_catalog_removals" CASCADE;
