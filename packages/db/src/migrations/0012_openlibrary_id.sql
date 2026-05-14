-- Add openlibrary_id column + index to torrents for the new Open
-- Library metadata source (books / ebooks). Stores a 13-digit ISBN,
-- a 10-digit ISBN, or an Open Library work id (`OL\d+W`) — whichever
-- the upload form resolved. categories.type is already a free-text
-- column so 'book' is a valid value with no schema change there.
ALTER TABLE "torrents" ADD COLUMN "openlibrary_id" text;
CREATE INDEX "torrents_openlibrary_idx" ON "torrents" ("openlibrary_id");
