/**
 * Donne un essaim à tout le catalogue d'une pile gardée.
 *
 * `demoTorrents.mjs` annonce pour les dix releases qu'il dépose lui-même. Dès
 * qu'un catalogue arrive par un autre chemin — une restauration de sauvegarde,
 * un import — ces torrents-là n'ont aucun pair, et chaque page de détail rend
 * son état « zéro seeder » : la carte de décision propose une remise en
 * partage, le tableau des pairs affiche son vide, et le dock annonce 0/0. Ce
 * n'est pas faux, mais c'est le seul état qu'on regarde alors, sur toutes les
 * pages à la fois.
 *
 *   node tests/e2e/demoSwarm.mjs
 *
 * Ce que ce script ne fait PAS : reprendre les compteurs d'une sauvegarde. La
 * table `torrent_stats` est un instantané que le collecteur réécrit ; les
 * chiffres qu'une page de détail affiche viennent de Redis, donc de vraies
 * annonces. La forme de chaque essaim est donc DÉRIVÉE de l'infohash —
 * déterministe, donc une relance réannonce les mêmes pairs au lieu de doubler
 * l'essaim, et deux torrents n'ont pas le même nombre de seeders.
 *
 * Comme `demo.mjs`, ce script n'asserte rien : ce n'est pas un scénario.
 */
import { API, announce, passkeyOf, resetRateLimits, sessions, sleep } from './lib.mjs';

/* Les comptes du harnais, plus ceux que `demoTorrents.mjs` a inscrits. Un pair
   est rattaché au membre dont la passkey a servi à l'annonce : sans plusieurs
   comptes, un essaim plafonne à une ligne. */
const EXTRA_CACHE = new URL('./session-torrents.json', import.meta.url);

/** Combien de pairs, et lesquels, pour un torrent donné. */
function shapeFor(infoHash, memberCount) {
  // Deux octets de l'infohash suffisent : on veut une variété stable, pas de
  // l'aléatoire. Au moins un seeder — un catalogue où rien n'est disponible
  // n'apprend rien de plus qu'un catalogue vide.
  const a = parseInt(infoHash.slice(0, 2), 16);
  const b = parseInt(infoHash.slice(2, 4), 16);
  const seeders = 1 + (a % Math.max(1, Math.min(memberCount, 5)));
  const leechers = b % 3;
  return { seeders, leechers: Math.min(leechers, Math.max(0, memberCount - seeders)) };
}

async function main() {
  const S = sessions(['founder']);

  let extra = {};
  try {
    const { readFileSync } = await import('node:fs');
    extra = JSON.parse(readFileSync(EXTRA_CACHE, 'utf8'));
  } catch {
    // Absent : la pile n'a que les trois comptes du seed. Les essaims seront
    // plus petits, rien de plus.
  }

  const cookies = Object.fromEntries([
    ...Object.entries(S).map(([k, v]) => [k, v.cookie]),
    ...Object.entries(extra).map(([k, v]) => [k, v.cookie]),
  ]);

  await resetRateLimits().catch(() => {});

  console.log('\n1. passkeys');
  const members = [];
  for (const [who, cookie] of Object.entries(cookies)) {
    const pk = await passkeyOf(cookie);
    if (pk) members.push({ who, passkey: pk });
  }
  console.log(`   ${members.length} membres : ${members.map((m) => m.who).join(' ')}`);
  if (!members.length) {
    console.error('aucune passkey — la pile est-elle bien celle du seed ?');
    process.exit(1);
  }

  console.log('\n2. catalogue');
  // Le catalogue est lu AVEC LES YEUX DE `founder`, et c'est une contrainte,
  // pas un détail : `/api/torrents` décide de montrer l'adulte d'après la
  // colonne `show_adult_content` de l'APPELANT, jamais d'après un paramètre de
  // requête. Un `?showAdultContent=true` dans l'URL ne fait rien du tout — zod
  // le retire, le schéma ne le déclare pas. Les lignes en attente, elles,
  // sortent parce que l'appelant est administrateur.
  //
  // Donc si le compte n'a pas activé l'adulte, ces torrents-là n'auront pas
  // d'essaim, et le compte rendu final le dit plutôt que de le taire.
  const items = [];
  for (let page = 1; page <= 20; page += 1) {
    const res = await fetch(
      `${API}/api/torrents?limit=100&page=${page}`,
      { headers: { cookie: S.founder.cookie } },
    );
    if (!res.ok) break;
    const body = await res.json();
    const batch = body?.data ?? [];
    items.push(...batch);
    if (batch.length < 100 || page >= (body?.pagination?.pages ?? 1)) break;
  }
  const total = items.length;
  console.log(`   ${total} torrents visibles par founder`);

  console.log('\n3. annonces');
  let announced = 0;
  let refused = 0;
  let skipped = 0;
  for (const t of items) {
    if (!t?.infoHash || typeof t.size !== 'number') {
      skipped += 1;
      continue;
    }
    const { seeders, leechers } = shapeFor(t.infoHash, members.length);
    const picked = [];
    for (let i = 0; i < seeders + leechers; i += 1) {
      // Décalage par l'infohash : ce n'est pas toujours `founder` qui seede.
      const offset = parseInt(t.infoHash.slice(4, 6), 16);
      picked.push(members[(offset + i) % members.length]);
    }
    for (let i = 0; i < picked.length; i += 1) {
      const m = picked[i];
      const isSeeder = i < seeders;
      const seed = `${t.infoHash}:${m.who}`;
      const port = 6881 + (i % 32);
      const first = await announce(m.passkey, t.infoHash, seed, {
        left: isSeeder ? t.size : Math.round(t.size * (0.15 + 0.7 * ((i + 1) / 8))),
        downloaded: 0,
        event: 'started',
        port,
      });
      if (first.failure) {
        refused += 1;
        if (refused <= 3) console.log(`   refus  ${m.who} -> ${t.infoHash.slice(0, 10)} : ${first.failure}`);
        continue;
      }
      if (isSeeder) {
        // La seconde annonce ferme le téléchargement : c'est elle qui compte un
        // snatch et qui fait passer le pair de leecher à seeder.
        await announce(m.passkey, t.infoHash, seed, {
          left: 0,
          uploaded: Math.round(t.size * (0.3 + (i % 4))),
          downloaded: t.size,
          event: 'completed',
          port,
        });
      }
      announced += 1;
    }
    await sleep(40);
  }
  console.log(`   ${announced} pairs posés, ${refused} refusés, ${skipped} torrents ignorés`);
  if (refused) {
    console.log(
      '   Un refus « Torrent not found or inactive » est le tracker qui fait son travail :',
    );
    console.log(
      '   une ligne en attente de modération n\'est pas annonçable, et ne doit pas l\'être.',
    );
  }

  // Le versement des crédits d'octets est groupé (5 s dans cette pile).
  console.log('\n   attente du versement des crédits (7 s)…');
  await sleep(7000);
  console.log('\nfini.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
