-- Add subcategories support
-- Remove unique constraint on name to allow same name in different parents
ALTER TABLE "categories" DROP CONSTRAINT IF EXISTS "categories_name_unique";
--> statement-breakpoint
-- Add parent_id column for hierarchical categories
ALTER TABLE "categories" ADD COLUMN IF NOT EXISTS "parent_id" text;
--> statement-breakpoint
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                 WHERE conname = 'categories_parent_id_fk' AND conrelid = 'public.categories'::regclass) THEN
    ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fk" 
      FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE CASCADE;
  END IF;
END $$;
--> statement-breakpoint
-- Add index for efficient parent lookups
CREATE INDEX IF NOT EXISTS "categories_parent_idx" ON "categories" ("parent_id");
--> statement-breakpoint
-- Add unique constraint on (parent_id, name) to prevent duplicates within same parent
CREATE UNIQUE INDEX IF NOT EXISTS "categories_parent_name_idx" ON "categories" (COALESCE("parent_id", ''), "name");
