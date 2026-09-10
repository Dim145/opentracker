-- Le catalogue, suite : des alertes fidèles, des titres d'œuvres, ce qu'on cherche en vain.
--
-- `saved_searches` reçoit les critères de la barre (groupes d'étiquettes, saison,
-- épisode, année, uploadeur) : enregistrée, une recherche se reproduit telle
-- qu'on l'avait sous les yeux. `users.catalogue_defaults` garde les filtres
-- qu'un membre veut retrouver à chaque ouverture. `work_titles` indexe les titres
-- que les fournisseurs de métadonnées donnent, pour que la recherche trouve une
-- œuvre par son nom et propose « vouliez-vous dire ». `search_misses` compte
-- les recherches à zéro résultat, pour l'administration.
CREATE TABLE "search_misses" (
	"query" text PRIMARY KEY NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"first_at" timestamp DEFAULT now() NOT NULL,
	"last_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_titles" (
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"bare_id" text NOT NULL,
	"locale" text NOT NULL,
	"title" text NOT NULL,
	"original_title" text,
	"year" smallint,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "work_titles_source_external_id_locale_pk" PRIMARY KEY("source","external_id","locale")
);
--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "tag_groups" text;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "season" smallint;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "episode" smallint;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "year" smallint;--> statement-breakpoint
ALTER TABLE "saved_searches" ADD COLUMN "uploader_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "catalogue_defaults" jsonb;--> statement-breakpoint
CREATE INDEX "search_misses_count_idx" ON "search_misses" USING btree ("count" DESC NULLS LAST,"last_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_titles_bare_idx" ON "work_titles" USING btree ("source","bare_id");--> statement-breakpoint
CREATE INDEX "work_titles_fts_idx" ON "work_titles" USING gin (to_tsvector('simple', coalesce(translate("title", '._', '  '), '')));--> statement-breakpoint
CREATE INDEX "work_titles_trgm_idx" ON "work_titles" USING gin ("title" gin_trgm_ops);--> statement-breakpoint
ALTER TABLE "saved_searches" ADD CONSTRAINT "saved_searches_uploader_id_users_id_fk" FOREIGN KEY ("uploader_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;