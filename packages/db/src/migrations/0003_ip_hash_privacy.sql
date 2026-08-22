DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'announce_log' AND column_name = 'ip')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns
                     WHERE table_name = 'announce_log' AND column_name = 'ip_hash') THEN
    ALTER TABLE announce_log RENAME COLUMN ip TO ip_hash;
  END IF;
END $$;
--> statement-breakpoint
-- Add comment explaining the column
COMMENT ON COLUMN announce_log.ip_hash IS 'SHA256 hash of client IP (first 16 chars). Rotates daily for privacy.';
