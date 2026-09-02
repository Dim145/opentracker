-- Dix-huit clés étrangères sans index en tête.
--
-- Deux coûts distincts, et le premier est celui qu'on ne voit pas venir : un
-- `DELETE` ou un `UPDATE` sur la table PARENTE force Postgres à balayer la
-- table enfant en entier pour valider la contrainte. Supprimer un torrent
-- scannait donc `torrent_comments`, `torrent_favorites`, `anticheat_flags` et
-- `upload_request_fill_attempts` de bout en bout. Le second est direct : « ses
-- commentaires » sur un profil, « les messages de ce sujet » au forum, et les
-- effacements RGPD ajoutés sur `message_reactions` /
-- `room_message_reactions` sont exactement des jointures sur ces colonnes.
--
-- Les ~30 autres colonnes de clé étrangère non indexées sont administratives
-- (`created_by`, `updated_by`, `reviewed_by_id`, `deleted_by_id`,
-- `moderated_by_id`…) : leur seul intérêt serait la validation de contrainte,
-- et comme la ligne `users` survit à l'effacement de compte, cette validation
-- ne se déclenche presque jamais. Arbitrage assumé, écrit ici pour qu'il ne
-- passe pas pour un oubli.
--
-- SUR UNE BASE ÉTABLIE : `CREATE INDEX` prend un verrou SHARE, qui bloque les
-- écritures de la table le temps de la construction — et les migrations
-- tournent au démarrage de l'API. Sur une instance avec des millions de
-- commentaires ou de messages, poser ces index HORS BANDE avant de déployer,
-- puis laisser la migration les trouver déjà là :
--
--   CREATE INDEX CONCURRENTLY IF NOT EXISTS forum_posts_topic_idx
--     ON forum_posts USING btree (topic_id);
--   -- … et ainsi de suite pour chacun ci-dessous.
--
-- `CONCURRENTLY` ne peut pas figurer ici : le migrateur drizzle enveloppe le
-- fichier dans une transaction, et Postgres l'interdit dans ce contexte.

CREATE INDEX IF NOT EXISTS "anticheat_flags_torrent_idx" ON "anticheat_flags" USING btree ("torrent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forum_posts_topic_idx" ON "forum_posts" USING btree ("topic_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forum_posts_author_idx" ON "forum_posts" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forum_topics_category_idx" ON "forum_topics" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "forum_topics_author_idx" ON "forum_topics" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "freeleech_pool_contributions_user_idx" ON "freeleech_pool_contributions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "message_reactions_user_idx" ON "message_reactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_reply_to_idx" ON "messages" USING btree ("reply_to_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "messages_author_idx" ON "messages" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "room_message_reactions_user_idx" ON "room_message_reactions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "saved_searches_category_idx" ON "saved_searches" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ticket_messages_author_idx" ON "ticket_messages" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "torrent_comments_torrent_idx" ON "torrent_comments" USING btree ("torrent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "torrent_comments_author_idx" ON "torrent_comments" USING btree ("author_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "torrent_favorites_torrent_idx" ON "torrent_favorites" USING btree ("torrent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_request_fill_attempts_torrent_idx" ON "upload_request_fill_attempts" USING btree ("torrent_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_request_fill_attempts_user_idx" ON "upload_request_fill_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "upload_requests_category_idx" ON "upload_requests" USING btree ("category_id");