-- Quand le personnel édite les mots de quelqu'un, ça se voit.
--
-- `forum/posts/[id].patch.ts:44` laissait déjà un modérateur réécrire le
-- message d'un membre, et rien ne le disait : ni au lecteur, ni au membre
-- lui-même. Un `updated_at` bouge aussi quand l'auteur se corrige — il ne
-- distingue pas les deux. Éditer sans marque, c'est faire dire à quelqu'un ce
-- qu'il n'a pas dit.
--
-- Les commentaires de torrent, eux, n'avaient AUCUNE route d'édition : un
-- modérateur devait supprimer tout un commentaire utile pour en retirer une
-- ligne. La colonne sert donc aux deux : elle ouvre l'édition côté torrent, et
-- elle la rend honnête des deux côtés.
--
-- NULL = l'auteur s'est corrigé lui-même, ce qui ne regarde personne.
ALTER TABLE "torrent_comments" ADD COLUMN "edited_by_id" text;--> statement-breakpoint
ALTER TABLE "torrent_comments" ADD COLUMN "edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "torrent_comments" ADD CONSTRAINT "torrent_comments_edited_by_id_users_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "forum_posts" ADD COLUMN "edited_by_id" text;--> statement-breakpoint
ALTER TABLE "forum_posts" ADD COLUMN "edited_at" timestamp;--> statement-breakpoint
ALTER TABLE "forum_posts" ADD CONSTRAINT "forum_posts_edited_by_id_users_id_fk" FOREIGN KEY ("edited_by_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
