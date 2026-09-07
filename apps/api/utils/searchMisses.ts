import { sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { redis } from '~~/utils/server';

/** La table reste sous ce nombre de lignes : au-delà, les moins demandées et les plus anciennes partent. */
const MAX_ROWS = 5000;
/** Ce qu'un membre peut faire compter par heure : au-delà, on n'enregistre plus. */
const PER_USER_PER_HOUR = 30;

/**
 * Compter une recherche qui n'a rien rendu.
 *
 * Normalisée (minuscules, espaces repliés) pour qu'une même intention ne fasse
 * qu'une ligne ; ignorée sous trois caractères (une frappe en cours) et
 * au-delà de deux cents (un collage). Un infohash n'est pas une recherche
 * qu'on peut satisfaire en acquérant quelque chose : ignoré aussi.
 *
 * Deux bornes, parce qu'une recherche vide est gratuite à produire : un budget
 * horaire par membre (une boucle de chaînes aléatoires ne remplit pas la
 * table), et un plafond global élagué à chaque ligne nouvelle.
 */
export async function recordSearchMiss(raw: string, userId: string): Promise<void> {
  const query = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (query.length < 3 || query.length > 200) return;
  if (/^[0-9a-f]{40}$/.test(query)) return;
  try {
    const budgetKey = `misses:budget:${userId}`;
    const used = await redis.incr(budgetKey);
    if (used === 1) await redis.expire(budgetKey, 3600);
    if (used > PER_USER_PER_HOUR) return;
    // `xmax = 0` : la ligne vient d'être insérée ; sinon c'est le compteur d'une ligne existante.
    const rows = (await db.execute(sql`
      INSERT INTO ${schema.searchMisses} (query) VALUES (${query})
      ON CONFLICT (query) DO UPDATE
        SET count = ${schema.searchMisses}.count + 1, last_at = now()
      RETURNING (xmax = 0) AS inserted
    `)) as unknown as Array<{ inserted: boolean }>;
    if (rows[0]?.inserted) {
      await db.execute(sql`
        DELETE FROM ${schema.searchMisses}
         WHERE query IN (
           SELECT query FROM ${schema.searchMisses}
            ORDER BY count ASC, last_at ASC
            LIMIT GREATEST(0, (SELECT count(*) FROM ${schema.searchMisses}) - ${MAX_ROWS})
         )
      `);
    }
  } catch (err) {
    console.warn('[SearchMisses] record failed:', (err as Error).message);
  }
}
