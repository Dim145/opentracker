/**
 * Expression plein-texte partagée entre le schéma et les requêtes.
 *
 * Un index d'expression ne sert une requête que si l'expression interrogée est
 * la même que l'expression indexée. Les deux sortent donc d'ici : `schema.ts`
 * appelle `ftsVector()` pour déclarer les index GIN, la route de recherche
 * l'appelle pour construire son prédicat. Elles ne peuvent pas diverger.
 *
 * Le choix des index d'expression plutôt que de colonnes `GENERATED … STORED`
 * est dicté par le mode de gestion du schéma : le conteneur API fait un
 * `drizzle-kit push --force` au démarrage, qui réconcilie la base avec
 * `schema.ts`. Les index sont un terrain que push maîtrise bien ; les colonnes
 * générées le sont moins, et elles dupliqueraient en table un vecteur que
 * l'index contient déjà.
 */
import { sql, type SQL } from 'drizzle-orm';
import type { AnyColumn } from 'drizzle-orm';

/**
 * Configuration `simple` et non `french` : un nom de release n'est pas de la
 * prose. Le lemmatiseur réduirait « Remux », « Extended » ou « Complete » de
 * façon imprévisible, et la langue change d'une release à l'autre. `simple`
 * découpe et replie la casse, ce qu'on veut sur un catalogue multilingue.
 */
export const FTS_CONFIG = 'simple';

/**
 * Le vecteur indexé pour une colonne.
 *
 * `coalesce` fait partie de l'expression et non d'un confort d'écriture : sans
 * lui une colonne NULL produirait un vecteur NULL, la ligne sortirait de
 * l'index, et la requête cesserait de pouvoir s'en servir.
 */
export function ftsVector(column: AnyColumn | SQL): SQL {
  return sql`to_tsvector(${sql.raw(`'${FTS_CONFIG}'`)}, coalesce(${column}, ''))`;
}
