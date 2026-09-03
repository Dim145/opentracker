-- Généré par drizzle-kit, avec deux ajouts à la main que drizzle ne sait pas
-- exprimer et qui sont expliqués ici plutôt qu'en commentaire de schéma :
--
--  1. `NOT VALID` sur les trois contraintes de `catalog_records`. Les migrations
--     tournent au DÉMARRAGE de l'API : un `ADD CONSTRAINT` validé prendrait un
--     ACCESS EXCLUSIVE plus un scan complet de la table avant que la première
--     annonce ne soit servie. `NOT VALID` contraint immédiatement les écritures
--     nouvelles — ce qui est l'objet — et laisse la validation du passé à une
--     fenêtre de maintenance (`VALIDATE CONSTRAINT`, qui ne prend qu'un
--     SHARE UPDATE EXCLUSIVE).
--  2. Le remplissage de `phase` pour une base déjà chiffrée par une version
--     antérieure : elle a terminé son chiffrement, elle est simplement muette
--     sur la phase, et la laisser à `idle` ferait croire à un chiffrement à
--     reprendre.

DROP INDEX "invitations_code_idx";--> statement-breakpoint
DROP INDEX "message_reactions_message_idx";--> statement-breakpoint
ALTER TABLE "panic_state" ADD COLUMN "panic_password_hash" text;--> statement-breakpoint
ALTER TABLE "panic_state" ADD COLUMN "phase" text DEFAULT 'idle' NOT NULL;--> statement-breakpoint
ALTER TABLE "catalog_records" ADD CONSTRAINT "catalog_records_origin_ck" CHECK ("catalog_records"."origin" IN ('local', 'ingested')) NOT VALID;--> statement-breakpoint
ALTER TABLE "catalog_records" ADD CONSTRAINT "catalog_records_kind_ck" CHECK ("catalog_records"."kind" IN ('torrent', 'tombstone', 'identity', 'revocation')) NOT VALID;--> statement-breakpoint
ALTER TABLE "catalog_records" ADD CONSTRAINT "catalog_records_hops_ck" CHECK ("catalog_records"."hops" BETWEEN 0 AND 2) NOT VALID;--> statement-breakpoint
ALTER TABLE "panic_state" ADD CONSTRAINT "panic_state_phase_ck" CHECK ("panic_state"."phase" IN ('idle', 'encrypting', 'encrypted', 'restoring'));
--> statement-breakpoint
UPDATE "panic_state" SET "phase" = 'encrypted' WHERE "is_encrypted" = true;
