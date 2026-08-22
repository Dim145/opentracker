-- The partner's advertised federation protocol version, learned at handshake.
-- IF NOT EXISTS so a database that already pushed the current schema converges.
ALTER TABLE "federation_peers" ADD COLUMN IF NOT EXISTS "protocol_version" integer;
