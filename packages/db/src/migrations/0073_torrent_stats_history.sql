-- L'historique des essaims, un point par torrent et par jour.
--
-- `torrent_stats` est un instantané : il dit combien de sources il y a
-- maintenant, jamais s'il y en avait plus hier. La fiche d'un torrent veut la
-- tendance — sept jours de sources en courbe — et c'est cette table qui la
-- porte. Le collecteur y écrit à la fin de chaque passe complète et élague ce
-- qui a plus de trente jours.
--
-- La clé primaire (info_hash, day) est aussi l'index qu'il faut : la fiche lit
-- les sept dernières lignes d'UN torrent, l'élagage balaie par `day` — et un
-- index séparé sur `day` seul n'a pas été jugé utile : l'élagage tourne une
-- fois par heure sur une table qui ne grandit que de N lignes par jour.
CREATE TABLE "torrent_stats_history" (
	"info_hash" text NOT NULL,
	"day" date NOT NULL,
	"seeders" integer DEFAULT 0 NOT NULL,
	"leechers" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "torrent_stats_history_info_hash_day_pk" PRIMARY KEY("info_hash","day")
);
--> statement-breakpoint
ALTER TABLE "torrent_stats_history" ADD CONSTRAINT "torrent_stats_history_info_hash_torrents_info_hash_fk" FOREIGN KEY ("info_hash") REFERENCES "public"."torrents"("info_hash") ON DELETE cascade ON UPDATE no action;
