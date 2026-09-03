-- L'unicité du pseudonyme, insensible à la casse.
--
-- `users.username` portait un `UNIQUE` sur la valeur exacte : `Admin` pouvait
-- donc être créé alors qu'`admin` existait. Le jeu de caractères autorisé est
-- `[a-zA-Z0-9_-]`, donc pas d'homographes Unicode — mais la collision par casse
-- suffit à usurper un pseudonyme de personnel dans les commentaires, le forum,
-- les messages privés et le journal de modération, et `auth/challenge` étant
-- lui aussi sensible à la casse, les deux comptes se connectent normalement.
--
-- ATTENTION À L'INSTALLATION : si une base existante contient déjà deux
-- pseudonymes qui ne diffèrent que par la casse, cette migration ÉCHOUE — et
-- c'est le bon comportement, parce que la fusion n'est pas une décision qu'une
-- migration peut prendre. Pour les repérer avant :
--
--   SELECT lower(username), count(*), array_agg(username)
--     FROM users GROUP BY 1 HAVING count(*) > 1;

CREATE UNIQUE INDEX "users_username_lower_unique" ON "users" USING btree (lower("username"));