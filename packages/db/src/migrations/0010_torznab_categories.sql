-- Add newznabId column to categories table for Torznab API integration
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "newznab_id" integer;
