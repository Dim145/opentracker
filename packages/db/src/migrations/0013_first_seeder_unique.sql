-- Defence-in-depth for `applyFirstSeederRule`: only one first_seeder
-- grant per torrent can ever exist. The application-level gate
-- (apps/api/utils/bonusEarning.ts) already filters duplicates, but
-- a race where two API replicas both held a stale view of the
-- cross-replica SETNX lock would slip a second insert through. The
-- DB constraint closes that path without adding cost on the hot
-- seeding path — the partial WHERE keeps the index narrow so
-- seeding / milestone / account_age_monthly inserts (which are
-- intentionally per-user) are untouched.
--
-- Pre-existing duplicates on a long-running install are unlikely
-- (the source has been per-user keyed) but defensive: a DELETE
-- step keeps only the earliest `first_seeder` grant per torrent
-- so the unique index creation succeeds. The collector treats
-- the prize as one-per-torrent anyway, so dropping the late
-- duplicates here matches the new semantics rather than rewrites
-- them.
DELETE FROM "bonus_grants" a
  USING "bonus_grants" b
  WHERE a.source = 'first_seeder'
    AND b.source = 'first_seeder'
    AND a.torrent_id IS NOT NULL
    AND a.torrent_id = b.torrent_id
    AND (a.created_at, a.id) > (b.created_at, b.id);

CREATE UNIQUE INDEX "bonus_grants_first_seeder_unique_idx"
  ON "bonus_grants" ("torrent_id")
  WHERE source = 'first_seeder' AND torrent_id IS NOT NULL;
