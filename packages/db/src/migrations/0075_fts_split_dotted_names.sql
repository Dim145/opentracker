-- La recherche plein texte découpe désormais les noms pointés.
--
-- `Sousou.no.Frieren.S01E09.VOSTFR.1080p.WEBRip` est UN jeton pour l'analyseur
-- de Postgres (une forme d'hôte ou de fichier) : « frieren » ne trouvait qu'une
-- release sur neuf, et le repli approximatif masquait le trou tant que la
-- recherche exacte rendait zéro. Le vecteur indexé remplace points et
-- soulignés par des espaces avant `to_tsvector` (voir `packages/db/src/search.ts`,
-- même expression côté requête, sinon l'index ne servirait plus).
--
-- Quatre index recréés : le temps d'un CREATE INDEX par table — sur un gros
-- catalogue, quelques secondes pendant lesquelles les écritures attendent.
DROP INDEX "tags_fts_name_idx";--> statement-breakpoint
DROP INDEX "torrents_fts_name_idx";--> statement-breakpoint
DROP INDEX "torrents_fts_description_idx";--> statement-breakpoint
DROP INDEX "torrents_fts_nfo_idx";--> statement-breakpoint
CREATE INDEX "tags_fts_name_idx" ON "tags" USING gin (to_tsvector('simple', coalesce(translate("name", '._', '  '), '')));--> statement-breakpoint
CREATE INDEX "torrents_fts_name_idx" ON "torrents" USING gin (to_tsvector('simple', coalesce(translate("name", '._', '  '), '')));--> statement-breakpoint
CREATE INDEX "torrents_fts_description_idx" ON "torrents" USING gin (to_tsvector('simple', coalesce(translate("description", '._', '  '), '')));--> statement-breakpoint
CREATE INDEX "torrents_fts_nfo_idx" ON "torrents" USING gin (to_tsvector('simple', coalesce(translate("nfo", '._', '  '), '')));