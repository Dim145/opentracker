import { sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';

/**
 * Compter une recherche qui n'a rien rendu.
 *
 * Normalisée (minuscules, espaces repliés) pour qu'une même intention ne fasse
 * qu'une ligne ; ignorée sous trois caractères (une frappe en cours) et
 * au-delà de deux cents (un collage). Un infohash n'est pas une recherche
 * qu'on peut satisfaire en acquérant quelque chose : ignoré aussi.
 */
export async function recordSearchMiss(raw: string): Promise<void> {
  const query = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (query.length < 3 || query.length > 200) return;
  if (/^[0-9a-f]{40}$/.test(query)) return;
  try {
    await db.execute(sql`
      INSERT INTO ${schema.searchMisses} (query) VALUES (${query})
      ON CONFLICT (query) DO UPDATE
        SET count = ${schema.searchMisses}.count + 1, last_at = now()
    `);
  } catch (err) {
    console.warn('[SearchMisses] record failed:', (err as Error).message);
  }
}
