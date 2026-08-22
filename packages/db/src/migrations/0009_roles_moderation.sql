-- Roles table for flexible permission management
CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  color TEXT DEFAULT '#6b7280' NOT NULL,
  can_upload_without_moderation BOOLEAN DEFAULT false NOT NULL,
  created_at TIMESTAMP DEFAULT NOW() NOT NULL
);
--> statement-breakpoint
-- Add roleId to users (nullable - users without roles use default permissions)
ALTER TABLE users ADD COLUMN IF NOT EXISTS role_id TEXT REFERENCES roles(id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS users_role_idx ON users(role_id);
--> statement-breakpoint
-- Add isApproved to torrents (default true for backward compatibility with existing torrents)
ALTER TABLE torrents ADD COLUMN IF NOT EXISTS is_approved BOOLEAN DEFAULT true NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS torrents_approved_idx ON torrents(is_approved);
