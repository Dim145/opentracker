-- La modération cesse d'être quatre files de maturité inégale.
--
-- Le produit savait déjà bien faire une file — `anticheat_flags` porte une
-- taxonomie (`kind`), une priorité (`severity`), un verdict et sa note, et la
-- seule route par lot du produit. `tickets` savait déjà gérer un dossier —
-- assignation, relance, motif de clôture. Les envois et les signalements
-- n'avaient rien de tout cela : trois colonnes de modération sur `torrents`,
-- un `resolved_by` sur `reports`, et du texte libre partout.
--
-- Cette migration leur donne la même forme :
--
--   · réclamation  — `claimed_by` + `claimed_at`, pour que deux modérateurs
--                    ne travaillent pas le même élément sans le savoir. La
--                    réclamation EXPIRE (voir `utils/moderationQueue.ts`) :
--                    un onglet fermé ne doit pas geler un envoi.
--   · mise en veille — `snoozed_until`, pour sortir de la file ce qui attend
--                    une réponse du membre sans avoir à le clore.
--   · motif typé   — `reason_code`, à côté du message libre qui reste
--                    obligatoire. Les codes vivent dans `packages/shared`
--                    (constante typée, libellés traduits) et non ici : une
--                    table ne se traduit pas par locale.
--
-- Et `user_warnings` ajoute le cran qui manquait entre « rien » et « bannir ».

ALTER TABLE "torrents" ADD COLUMN "moderation_claimed_by_id" text;--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN "moderation_claimed_at" timestamp;--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN "moderation_snoozed_until" timestamp;--> statement-breakpoint
ALTER TABLE "torrents" ADD COLUMN "moderation_reason_code" text;--> statement-breakpoint
ALTER TABLE "torrents" ADD CONSTRAINT "torrents_moderation_claimed_by_id_users_id_fk" FOREIGN KEY ("moderation_claimed_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "reports" ADD COLUMN "assigned_to_id" text;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "assigned_at" timestamp;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "snoozed_until" timestamp;--> statement-breakpoint
ALTER TABLE "reports" ADD COLUMN "reason_code" text;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_assigned_to_id_users_id_fk" FOREIGN KEY ("assigned_to_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Un avertissement est consigné, visible du membre, et compte dans son
-- historique sans rien couper. `expires_at` NULL = ne s'efface jamais ;
-- `acknowledged_at` retient que le membre l'a lu, ce qui est la seule preuve
-- qu'un avertissement a servi à quelque chose.
CREATE TABLE "user_warnings" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"issued_by_id" text,
	"reason_code" text NOT NULL,
	"message" text NOT NULL,
	"source_type" text,
	"source_id" text,
	"expires_at" timestamp,
	"acknowledged_at" timestamp,
	"revoked_at" timestamp,
	"revoked_by_id" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "user_warnings" ADD CONSTRAINT "user_warnings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_warnings" ADD CONSTRAINT "user_warnings_issued_by_id_users_id_fk" FOREIGN KEY ("issued_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_warnings" ADD CONSTRAINT "user_warnings_revoked_by_id_users_id_fk" FOREIGN KEY ("revoked_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

-- Les avertissements d'un membre, les plus récents d'abord : c'est la seule
-- lecture que font la fiche de profil et le bandeau de signaux.
CREATE INDEX "user_warnings_user_idx" ON "user_warnings" USING btree ("user_id","created_at" DESC);--> statement-breakpoint

-- La file de modération se lit toujours avec le même prédicat. L'index partiel
-- ne couvre donc que les lignes en attente — quelques dizaines — au lieu du
-- catalogue entier.
CREATE INDEX "torrents_moderation_queue_idx" ON "torrents" USING btree ("moderation_snoozed_until","created_at") WHERE "moderation_status" = 'pending';--> statement-breakpoint

-- Même raisonnement côté signalements : seuls les non traités sont lus.
CREATE INDEX "reports_open_queue_idx" ON "reports" USING btree ("snoozed_until","created_at") WHERE "status" = 'pending';
