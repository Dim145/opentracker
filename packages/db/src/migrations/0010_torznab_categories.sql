-- Add newznabId column to categories table for Torznab API integration
ALTER TABLE "categories" ADD COLUMN "newznab_id" integer;
