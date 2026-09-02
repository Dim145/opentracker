/**
 * Un horodatage sorti de `db.execute()` remis en instant absolu.
 *
 * `packages/db` déclare un analyseur pour l'OID 1114 — voir son en-tête : les
 * colonnes `timestamp without time zone` du schéma contiennent de l'heure
 * murale UTC, et cet analyseur les relit en UTC plutôt que dans le fuseau du
 * processus. Il couvre `db.select()` et le constructeur de requêtes.
 *
 * Il ne couvre PAS `db.execute()`. Mesuré le 2026-09-02, deux fois — à travers
 * l'API et en reproduisant le même chemin drizzle isolément :
 *
 *   db.select(...)   → 2026-09-02T16:41:33.452Z   (Date)
 *   db.execute(sql`…`) → "2026-09-02 16:41:33.779157"  (chaîne brute)
 *
 * postgres.js seul analyse correctement dans les quatre combinaisons
 * (`unsafe` ou requête étiquetée, `prepare` vrai ou faux) : la perte se produit
 * dans la couche drizzle. Le générique de `db.execute<{ created_at: Date }>`
 * n'est qu'une assertion, jamais vérifiée — c'est ce qui a laissé passer la
 * chose.
 *
 * Sans conversion, cette chaîne part telle quelle dans le JSON, et
 * `new Date("2026-09-02 16:41:33.779157")` la lit dans le fuseau LOCAL du
 * navigateur. Sur le forum, cela donnait « il y a 2 heures » pour un message
 * publié depuis douze minutes, et un défaut d'hydratation par-dessus : le
 * rendu serveur (conteneur en UTC) et le client (Europe/Paris) calculaient
 * deux durées différentes à partir du même octet.
 */
export function naiveTimestampToIso(
  value: Date | string | null | undefined
): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  const raw = String(value);
  // Déjà un instant : `…Z` ou un décalage explicite. On n'y touche pas.
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(raw)) return new Date(raw).toISOString();
  // La forme que rend Postgres : « 2026-09-02 16:41:33.779157 », heure murale
  // UTC. On la déclare telle en remplaçant l'espace et en ajoutant le Z.
  const d = new Date(`${raw.replace(' ', 'T')}Z`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
