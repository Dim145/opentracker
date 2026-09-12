/**
 * Remplit une pile e2e gardée de torrents qui valent le coup d'œil.
 *
 * `demo.mjs` fabrique des rôles, des conversations et un salon — tout sauf des
 * torrents. `torrentVisibility.mjs` en dépose bien quatre, mais ce sont des
 * fixtures d'assertion : des noms comme `e2e-vis-public-accepted`, aucune
 * description, aucun NFO, aucun pair. Une page de détail nourrie de ça ne
 * montre que ses états vides, et c'est exactement ce qu'on ne peut pas juger.
 *
 * Ce script construit donc ce que la page est censée rendre :
 *
 *   - des noms de release réels, parce que les pastilles de qualité sont
 *     ANALYSÉES depuis le nom (`releaseChips.ts`) et non stockées ;
 *   - un bloc MediaInfo dans le NFO, parce que les tables de pistes audio et
 *     de sous-titres sont analysées depuis ce texte — le schéma n'a aucune
 *     colonne par piste (voir l'en-tête de `TrackTables.vue`) ;
 *   - une description en BBCode, pour que `DescriptionRender` ait de quoi
 *     faire et que le pavé de l'uploadeur pèse ce qu'il pèse en vrai ;
 *   - un cross-seed VRAI : même liste de fichiers, `piece length` différente,
 *     donc même `content_signature` et un info_hash distinct ;
 *   - un groupe : deux éditions du même film sous le même `tmdbId`, ce qui est
 *     la seule façon de voir la table des versions se remplir ;
 *   - une supersession, un freeleech avec échéance, un épinglage ;
 *   - des commentaires, un favori, une obligation de seed ;
 *   - un essaim, en annonçant sur le VRAI tracker avec la VRAIE passkey de
 *     chaque compte.
 *
 *   node tests/e2e/demoTorrents.mjs
 *
 * Rejouable : un torrent déjà déposé est repris tel quel plutôt que dupliqué,
 * et les comptes déjà inscrits se connectent.
 *
 * Comme `demo.mjs`, ce script n'asserte rien — ce n'est pas un scénario, et
 * `run.sh` ne l'appelle pas.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { generateCredentials, generateLoginProof, solvePoW } from './crypto.mjs';
import { announce, resetRateLimits } from './lib.mjs';

const API = process.env.E2E_API ?? 'http://localhost:54000';
const WEB = process.env.E2E_WEB ?? 'http://localhost:53000';
const HERE = new URL('.', import.meta.url);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const S = JSON.parse(readFileSync(new URL('session.json', HERE), 'utf8'));

/* ── HTTP ─────────────────────────────────────────────────────────────────── */

const jars = new Map();
const jarFor = (name) => {
  if (!jars.has(name)) jars.set(name, new Map());
  return jars.get(name);
};
const cookieHeader = (jar) => [...jar.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
function absorb(jar, res) {
  for (const raw of res.headers.getSetCookie?.() ?? []) {
    const [pair] = raw.split(';');
    const i = pair.indexOf('=');
    if (i > 0) jar.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
  }
}

/** Le cookie d'un compte : celui du seed pour les trois de base, le jar sinon. */
function cookieOf(who) {
  if (S[who]?.cookie) return S[who].cookie;
  const jar = jarFor(who);
  return jar.size ? cookieHeader(jar) : '';
}

async function call(path, { method = 'GET', body, who, jar, raw = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['content-type'] = 'application/json';
  const cookie = jar ? cookieHeader(jar) : who ? cookieOf(who) : '';
  if (cookie) headers.cookie = cookie;
  const res = await fetch(API + path, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  if (jar) absorb(jar, res);
  if (raw) return { status: res.status, buffer: Buffer.from(await res.arrayBuffer()) };
  const text = await res.text();
  let parsed = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }
  return { status: res.status, body: parsed };
}

const ok = (s) => s >= 200 && s < 300;
let steps = 0;
let problems = 0;
const step = (label, good, detail = '') => {
  steps += 1;
  if (!good) problems += 1;
  console.log(`  ${good ? 'ok  ' : 'FAIL'} ${label}${detail ? `   ${detail}` : ''}`);
};

/* ── bencode ──────────────────────────────────────────────────────────────── */
//
// Repris de `torrentVisibility.mjs` : le harnais est délibérément sans
// dépendance, et une deuxième implémentation d'un encodeur de dix lignes coûte
// moins qu'un paquet à auditer.

function bencode(value) {
  if (Buffer.isBuffer(value)) return Buffer.concat([Buffer.from(`${value.length}:`), value]);
  if (typeof value === 'string') return bencode(Buffer.from(value, 'utf8'));
  if (typeof value === 'number') return Buffer.from(`i${Math.trunc(value)}e`);
  if (Array.isArray(value)) {
    return Buffer.concat([Buffer.from('l'), ...value.map(bencode), Buffer.from('e')]);
  }
  if (value && typeof value === 'object') {
    // Clés en ordre lexicographique : sans ça l'info_hash calculé n'est pas
    // celui qu'un client calculerait.
    const keys = Object.keys(value).sort();
    return Buffer.concat([
      Buffer.from('d'),
      ...keys.flatMap((k) => [bencode(k), bencode(value[k])]),
      Buffer.from('e'),
    ]);
  }
  throw new Error(`cannot bencode ${typeof value}`);
}

/**
 * Un .torrent multi-fichiers.
 *
 * Les hachages de pièces sont dérivés du nom, pas d'un contenu : rien sur le
 * chemin d'upload ne les vérifie, il lui faut vingt octets par pièce. Ce qui
 * compte ici c'est que la liste de fichiers soit réelle, parce que c'est elle
 * que `computeContentSignature` canonise — et donc elle qui décide de ce qui
 * est un cross-seed de quoi.
 *
 * `pieceLength` est un paramètre pour cette raison précise : le passer à une
 * autre puissance de deux change l'info_hash SANS changer la signature de
 * contenu. C'est la définition d'un cross-seed, et c'est comment on en
 * fabrique un.
 *
 * Le nombre de pièces est plafonné : 82 Gio en pièces de 4 Mio, ce sont 21 000
 * hachages, soit 420 Kio de `pieces` — au-dessus de la limite de taille du
 * .torrent envoyé, et sans utilité ici puisque personne ne vérifie un octet.
 */
function torrentFile({ name, files, pieceLength = 4 * 1024 * 1024 }) {
  const total = files.reduce((n, f) => n + f.length, 0);
  const count = Math.min(512, Math.max(1, Math.ceil(total / pieceLength)));
  const pieces = Buffer.concat(
    Array.from({ length: count }, (_, i) =>
      createHash('sha1').update(`${name}:${pieceLength}:${i}`).digest(),
    ),
  );
  return bencode({
    announce: 'http://tracker.e2e.test/announce',
    'created by': 'trackarr-e2e/demoTorrents',
    'creation date': Math.floor(Date.now() / 1000),
    info: {
      files: files.map((f) => ({ length: f.length, path: f.path.split('/') })),
      name,
      'piece length': pieceLength,
      pieces,
      private: 1,
    },
  });
}

/** L'upload est multipart ; `call` parle JSON, donc celui-ci est à la main. */
async function upload(who, fields, torrentBytes) {
  const boundary = `----trackarr${randomBytes(8).toString('hex')}`;
  const parts = [];
  const field = (headers, body) => {
    parts.push(Buffer.from(`--${boundary}\r\n${headers}\r\n\r\n`), body, Buffer.from('\r\n'));
  };
  field(
    'Content-Disposition: form-data; name="torrent"; filename="release.torrent"\r\n' +
      'Content-Type: application/x-bittorrent',
    torrentBytes,
  );
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue;
    field(`Content-Disposition: form-data; name="${key}"`, Buffer.from(String(value), 'utf8'));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));

  const res = await fetch(`${API}/api/torrents`, {
    method: 'POST',
    headers: {
      cookie: cookieOf(who),
      'content-type': `multipart/form-data; boundary=${boundary}`,
    },
    body: Buffer.concat(parts),
  });
  const text = await res.text();
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { status: res.status, body };
}

/* ── MediaInfo ────────────────────────────────────────────────────────────── */
//
// Le format est celui de MediaInfo, pas un résumé maison : c'est ce que
// `parseMediaInfoText()` sait relire (`^(General|Video|Audio|Text)\s*#?\d*$`
// puis des lignes `clé : valeur`). Un libellé inventé est ignoré en silence.

const mi = (blocks) =>
  blocks
    .map(([title, rows]) =>
      [title, ...rows.filter(([, v]) => v).map(([k, v]) => `${k.padEnd(40)}: ${v}`)].join('\n'),
    )
    .join('\n\n');

/* ── Les fixtures ─────────────────────────────────────────────────────────────
 *
 * TOUTES les œuvres citées ici sont librement diffusables, et c'est une
 * contrainte, pas un hasard : ce script alimente la pile qui sert à prendre
 * les captures du README. Une capture montre ce qu'elle montre — un titre
 * sous droits, une affiche sous droits, et le dépôt les publie.
 *
 *   La Nuit des morts-vivants (1968)  domaine public (mention de copyright
 *                                     omise des copies d'exploitation)
 *   Le Voyage dans la Lune (1902)     domaine public
 *   Sherlock Holmes (1954)            domaine public (copyright non renouvelé)
 *   Pioneer One (2010)                CC BY-NC-SA — la première série
 *                                     financée et diffusée par BitTorrent
 *   Ghosts I-IV (2008)                CC BY-NC-SA, publiée par le groupe
 *                                     lui-même en torrent
 *   0 A.D.                            GPL v2 (moteur) / CC BY-SA (contenu)
 *   Standard Ebooks / Jules Verne     domaine public
 *
 * Les affiches et toiles de fond viennent de TMDb, mais ce sont celles
 * d'œuvres libres : les publier dans une capture ne pose pas le problème que
 * posait l'ancien jeu de données.
 * ────────────────────────────────────────────────────────────────────────── */

const NOTLD_ROOT =
  'Night.of.the.Living.Dead.1968.2160p.UHD.BluRay.REMUX.HDR.HEVC.FLAC.1.0-MoMA';

const notldFiles = [
  { path: `${NOTLD_ROOT}/${NOTLD_ROOT}.mkv`, length: 68_285_431_808 },
  { path: `${NOTLD_ROOT}/MoMA.nfo`, length: 11_402 },
  { path: `${NOTLD_ROOT}/Sample/sample.mkv`, length: 198_180_864 },
];

/* Un remux d'une restauration 4K : pas de Dolby Vision ni d'Atmos sur un
 * noir et blanc mono de 1968, mais deux pistes — le mono d'origine restauré
 * et le commentaire de Romero — et des sous-titres. */
const notldNfo = mi([
  ['General', [
    ['Complete name', `${NOTLD_ROOT}.mkv`],
    ['Format', 'Matroska'],
    ['File size', '63.6 GiB'],
    ['Duration', '1 h 36 min'],
    ['Overall bit rate', '88.2 Mb/s'],
  ]],
  ['Video', [
    ['Format', 'HEVC'],
    ['Format profile', 'Main 10@L5.1@High'],
    ['HDR format', 'SMPTE ST 2086, HDR10 compatible'],
    ['Width', '3 840 pixels'],
    ['Height', '2 160 pixels'],
    ['Display aspect ratio', '1.37:1'],
    ['Frame rate', '23.976 FPS'],
    ['Color space', 'YUV'],
    ['Chroma subsampling', '4:2:0'],
    ['Bit depth', '10 bits'],
    ['Bit rate', '86.4 Mb/s'],
    ['Title', 'Restauration 4K MoMA / Museum of Modern Art (2017)'],
  ]],
  ['Audio #1', [
    ['Format', 'FLAC'],
    ['Channel(s)', '1 channel'],
    ['Sampling rate', '48.0 kHz'],
    ['Bit depth', '24 bits'],
    ['Language', 'English'],
    ['Title', 'Mono d origine restauré'],
    ['Default', 'Yes'],
  ]],
  ['Audio #2', [
    ['Format', 'AC-3'],
    ['Channel(s)', '2 channels'],
    ['Bit rate', '192 kb/s'],
    ['Language', 'English'],
    ['Title', 'Commentaire de George A. Romero et de l équipe'],
    ['Default', 'No'],
  ]],
  ['Text #1', [
    ['Format', 'UTF-8'],
    ['Language', 'French'],
    ['Default', 'Yes'],
  ]],
  ['Text #2', [
    ['Format', 'UTF-8'],
    ['Language', 'English'],
    ['Title', 'English SDH'],
    ['Hearing impaired', 'Yes'],
  ]],
]);

const notldDescription = `[center][b]NIGHT OF THE LIVING DEAD[/b] — 1968 — George A. Romero[/center]

[quote]Barbra and her brother drive out to the cemetery to lay flowers on their father's grave. They will not leave together.[/quote]

[b]Source[/b]: Museum of Modern Art 4K restoration, full remux, no re-encode.
[b]Video[/b]: HEVC 10-bit, HDR10, film grain intact, original 1.37:1 frame.
[b]Audio[/b]: the 1968 mono in 24-bit FLAC, plus Romero's commentary track.
[b]Subtitles[/b]: English SDH, French.

[b]Notes[/b]
[list]
[*]The film is in the [b]public domain[/b]: the copyright notice was left off the release prints in 1968, and the law of the day did not forgive that.
[*]The [i]Sample[/i] folder holds 90 s of the cemetery sequence.
[*]Please keep seeding — it is 64 GiB, nobody pulls that in an hour.
[/list]`;

const HOLMES_ROOT = 'Sherlock.Holmes.1954.S01.1080p.WEB-DL.AAC.2.0.H.264-PUBDOM';
const holmesFiles = Array.from({ length: 39 }, (_, i) => ({
  path: `${HOLMES_ROOT}/Sherlock.Holmes.1954.S01E${String(i + 1).padStart(2, '0')}.1080p.WEB-DL.AAC.2.0.H.264-PUBDOM.mkv`,
  length: 1_181_116_006 + i * 12_582_912,
}));

const holmesNfo = mi([
  ['General', [
    ['Complete name', 'Sherlock.Holmes.1954.S01E01.1080p.WEB-DL.AAC.2.0.H.264-PUBDOM.mkv'],
    ['Format', 'Matroska'],
    ['File size', '1.10 GiB'],
    ['Duration', '25 min 42 s'],
    ['Overall bit rate', '6 132 kb/s'],
  ]],
  ['Video', [
    ['Format', 'AVC'],
    ['Format profile', 'High@L4'],
    ['Width', '1 440 pixels'],
    ['Height', '1 080 pixels'],
    ['Display aspect ratio', '4:3'],
    ['Frame rate', '23.976 FPS'],
    ['Bit depth', '8 bits'],
    ['Bit rate', '5 800 kb/s'],
    ['Language', 'English'],
  ]],
  ['Audio', [
    ['Format', 'AAC'],
    ['Channel(s)', '1 channel'],
    ['Bit rate', '192 kb/s'],
    ['Language', 'English'],
    ['Title', 'Mono d origine'],
    ['Default', 'Yes'],
  ]],
  ['Text #1', [
    ['Format', 'UTF-8'],
    ['Language', 'French'],
    ['Default', 'Yes'],
  ]],
  ['Text #2', [
    ['Format', 'UTF-8'],
    ['Language', 'English'],
    ['Title', 'English SDH'],
    ['Hearing impaired', 'Yes'],
  ]],
]);

const GHOSTS_ROOT = 'Nine Inch Nails - Ghosts I-IV (2008) [FLAC 24-96]';
const ghostsFiles = [
  ...Array.from({ length: 36 }, (_, i) => ({
    path: `${GHOSTS_ROOT}/${String(i + 1).padStart(2, '0')} - ${i + 1} Ghosts ${'I'.repeat(1 + (i % 4))}.ghosts`,
    length: 42_991_616 + i * 2_097_152,
  })),
  { path: `${GHOSTS_ROOT}/cover.jpg`, length: 3_145_728 },
  { path: `${GHOSTS_ROOT}/LICENSE.txt`, length: 1_874 },
];

const ghostsNfo = mi([
  ['General', [
    ['Complete name', '01 - 1 Ghosts I.ghosts'],
    ['Format', 'FLAC'],
    ['File size', '41.0 MiB'],
    ['Duration', '2 min 48 s'],
    ['Overall bit rate', '2 044 kb/s'],
  ]],
  ['Audio', [
    ['Format', 'FLAC'],
    ['Channel(s)', '2 channels'],
    ['Sampling rate', '96.0 kHz'],
    ['Bit depth', '24 bits'],
    ['Bit rate', '2 044 kb/s'],
    ['Title', 'Master 24 bits / 96 kHz publié par le groupe'],
    ['Default', 'Yes'],
  ]],
]);

const GAME_ROOT = '0 A.D. Alpha 27 Agni (Linux x86_64)';

/**
 * Ce que ce script dépose.
 *
 * `tmdbId` sert au regroupement de la page (`tmdb:10331` pour les quatre
 * éditions du film) — c'est la seule façon de voir la table des versions
 * autrement que vide.
 */
const RELEASES = [
  {
    key: 'notld4k',
    who: 'founder',
    category: 'films',
    name: NOTLD_ROOT,
    files: notldFiles,
    nfo: notldNfo,
    description: notldDescription,
    tmdbId: '10331',
    imdbId: 'tt0063350',
    tags: 'remux, hdr, restoration, public-domain, horror',
  },
  {
    // Le cross-seed : MÊME liste de fichiers, `piece length` de 8 Mio au lieu
    // de 4 — donc même `content_signature`, info_hash différent. Le nom
    // affiché diffère (c'est le champ `name` du formulaire, pas celui du
    // .torrent), comme quand la même release circule sous deux conventions.
    key: 'notld4kXseed',
    who: 'donator',
    category: 'films',
    name: `${NOTLD_ROOT} [pieces 8MiB]`,
    torrentName: NOTLD_ROOT,
    files: notldFiles,
    pieceLength: 8 * 1024 * 1024,
    nfo: notldNfo,
    description: `Cross-seed of the MoMA remux — identical content, 8 MiB piece length.

Handy if your client refuses to re-verify 64 GiB just to match the 4 MiB copy.`,
    tmdbId: '10331',
    tags: 'remux, cross-seed, restoration',
  },
  {
    key: 'notld1080',
    who: 'donator',
    category: 'films',
    name: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264.FLAC.1.0-PUBDOM',
    files: [
      {
        path: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264.FLAC.1.0-PUBDOM/Night.of.the.Living.Dead.1968.1080p.BluRay.x264.FLAC.1.0-PUBDOM.mkv',
        length: 12_884_901_888,
      },
      {
        path: 'Night.of.the.Living.Dead.1968.1080p.BluRay.x264.FLAC.1.0-PUBDOM/pubdom.nfo',
        length: 4_096,
      },
    ],
    description: `The 1080p edition, for anyone who does not have 64 GiB to spare.

[b]Superseded[/b] by the PROPER: the subtitles in this one drift about 400 ms out from the cellar sequence onward.`,
    tmdbId: '10331',
    tags: 'x264, public-domain, horror',
  },
  {
    key: 'notld1080proper',
    who: 'founder',
    category: 'films',
    name: 'Night.of.the.Living.Dead.1968.PROPER.1080p.BluRay.x264.FLAC.1.0-PUBDOM',
    files: [
      {
        path: 'Night.of.the.Living.Dead.1968.PROPER.1080p.BluRay.x264.FLAC.1.0-PUBDOM/Night.of.the.Living.Dead.1968.PROPER.1080p.BluRay.x264.FLAC.1.0-PUBDOM.mkv',
        length: 12_886_999_040,
      },
      {
        path: 'Night.of.the.Living.Dead.1968.PROPER.1080p.BluRay.x264.FLAC.1.0-PUBDOM/pubdom.nfo',
        length: 4_112,
      },
    ],
    description:
      'PROPER: the subtitles are back in sync. Everything else is bit-for-bit identical.',
    tmdbId: '10331',
    tags: 'x264, proper, public-domain',
  },
  {
    key: 'holmes',
    who: 'founder',
    category: 'series',
    name: HOLMES_ROOT,
    files: holmesFiles,
    nfo: holmesNfo,
    description: `[b]Sherlock Holmes[/b] (1954) — the complete season, 39 episodes, Ronald Howard as Holmes and Howard Marion-Crawford as Watson.

[list]
[*]Original mono, no heavy-handed noise reduction.
[*]English SDH and French subtitles, transcribed by hand.
[*]Original 4:3 frame, no cropping.
[/list]

The series never had its copyright renewed: it is in the [b]public domain[/b] in the United States. Nobody has to go looking for it anywhere shadier.

[b]×2 upload until Sunday[/b] — 39 episodes, the swarm needs a hand getting started.`,
    tmdbId: 'tv/6560',
    tags: 'web-dl, full-season, public-domain, detective',
  },
  {
    key: 'ghosts',
    who: 'donator',
    category: 'musique',
    name: 'Nine Inch Nails - Ghosts I-IV (2008) [FLAC 24-96 CC BY-NC-SA]',
    torrentName: GHOSTS_ROOT,
    files: ghostsFiles,
    nfo: ghostsNfo,
    description: `The 36 instrumental tracks the band released themselves in March 2008 under [b]Creative Commons BY-NC-SA[/b] — and put on BitTorrent the same day.

[b]Source[/b]: the 24-bit / 96 kHz master published on nin.com, not a rip.
[b]Encode[/b]: FLAC level 8, no normalisation.
[b]Included[/b]: the cover art and the licence text.

Probably the most legally shareable record in this library.`,
    tags: 'ghosts, 24bit, creative-commons, rock',
  },
  {
    key: 'game',
    who: 'founder',
    category: 'jeux',
    name: '0 A.D. Alpha 27 Agni (Linux x86_64) + all data packs',
    torrentName: GAME_ROOT,
    files: [
      { path: `${GAME_ROOT}/0ad-0.27.0-unix-build.tar.xz`, length: 1_073_741_824 },
      ...Array.from({ length: 11 }, (_, i) => ({
        path: `${GAME_ROOT}/0ad-0.27.0-unix-data-part${i + 1}.tar.xz`,
        length: 1_073_741_824,
      })),
      { path: `${GAME_ROOT}/GPL-2.0.txt`, length: 18_092 },
      { path: `${GAME_ROOT}/CC-BY-SA-3.0.txt`, length: 22_401 },
    ],
    description: `Free real-time strategy game by Wildfire Games. No DRM, and for good reason: the engine is [b]GPL v2[/b] and the assets are [b]CC BY-SA 3.0[/b].

[b]Contents[/b]: the full game, all thirteen civilisations, the official maps.
[b]Languages[/b]: everything the upstream repository ships.
[b]Install[/b]: unpack and run [i]./binaries/system/pyrogenesis[/i].`,
    tags: 'foss, drm-free, strategy, vf',
  },
  {
    key: 'ebook',
    who: 'plainuser',
    category: 'livres',
    name: 'Standard Ebooks - Jules Verne (12 novels) [EPUB]',
    torrentName: 'Standard Ebooks - Jules Verne',
    files: [
      ...[
        'Vingt mille lieues sous les mers',
        'Le Tour du monde en quatre-vingts jours',
        'Voyage au centre de la Terre',
        "De la Terre à la Lune",
        'Autour de la Lune',
        "L'Île mystérieuse",
        'Michel Strogoff',
        'Cinq semaines en ballon',
        'Les Enfants du capitaine Grant',
        'Robur le Conquérant',
        'Le Château des Carpathes',
        'Face au drapeau',
      ].map((title, i) => ({
        path: `Standard Ebooks - Jules Verne/${title}.epub`,
        length: 1_048_576 + i * 262_144,
      })),
      { path: 'Standard Ebooks - Jules Verne/CC0-1.0.txt', length: 7_048 },
    ],
    description: `Twelve Jules Verne novels in the Standard Ebooks editions: public-domain text, proofread and typeset, no DRM.

EPUB 3, table of contents and footnotes intact. The Standard Ebooks typesetting is itself dedicated to the public domain (CC0).`,
    tags: 'epub, public-domain, sci-fi, vf',
    // Personne n'annonce : c'est le torrent sans seeder, qui fait apparaître
    // la demande de reseed sur la page.
    noSwarm: true,
  },
  {
    key: 'pending',
    who: 'plainuser',
    category: 'films',
    name: 'Le.Voyage.dans.la.Lune.1902.1080p.BluRay.x265.10bit.FLAC.1.0-MELIES',
    files: [
      {
        path: 'Le.Voyage.dans.la.Lune.1902.1080p.BluRay.x265.10bit.FLAC.1.0-MELIES/Le.Voyage.dans.la.Lune.1902.1080p.x265-MELIES.mkv',
        length: 2_147_483_648,
      },
    ],
    description:
      'Home x265 encode, CRF 18, slow preset, from the restoration of the hand-coloured print found in 1993. Thirteen minutes, and the first science-fiction film ever made.',
    tmdbId: '775',
    tags: 'x265, self-encode, public-domain',
    // Laissé en attente : c'est ce qui rend visible le bandeau de modération
    // sur la page, pour son auteur et pour le personnel.
    keepPending: true,
    noSwarm: true,
  },
  {
    // Deux envois de plus laissés en attente : une file de modération à un seul
    // élément ne montre pas ce que la page fait d'une file.
    key: 'pendingCaminandes',
    who: 'donator',
    category: 'films',
    name: 'Caminandes.Llamigos.2016.2160p.WEB-DL.AV1-BLENDER',
    files: [
      {
        path: 'Caminandes.Llamigos.2016.2160p.WEB-DL.AV1-BLENDER/Caminandes.Llamigos.2016.2160p.AV1-BLENDER.mkv',
        length: 1_395_864_371,
      },
    ],
    description:
      'Third Caminandes short, from the Blender Studio 4K master. CC BY, like everything the studio publishes.',
    tmdbId: '406956',
    tags: 'web-dl, av1, creative-commons',
    keepPending: true,
    noSwarm: true,
  },
  {
    key: 'pendingXonotic',
    who: 'plainuser',
    category: 'jeux',
    name: 'Xonotic.0.8.6.Linux.x86_64-XONOTIC',
    files: [
      { path: 'Xonotic.0.8.6.Linux.x86_64-XONOTIC/xonotic-0.8.6.zip', length: 1_073_741_824 },
      { path: 'Xonotic.0.8.6.Linux.x86_64-XONOTIC/GPL-3.0.txt', length: 35_147 },
    ],
    description:
      'Free arena shooter, GPL v3. Official build, no launcher and no account.',
    tags: 'foss, drm-free, fps',
    keepPending: true,
    noSwarm: true,
  },
  {
    key: 'adult',
    who: 'founder',
    category: 'adulte',
    name: 'E2E.Adult.Fixture.2024.1080p.WEB-DL.x264-DEMO',
    files: [
      {
        path: 'E2E.Adult.Fixture.2024.1080p.WEB-DL.x264-DEMO/fixture.mkv',
        length: 3_221_225_472,
      },
    ],
    description:
      'Adult-category fixture. It exists only to exercise the detail page blur and the "show adult content" setting. There is no real work behind this name.',
    tags: 'web-dl',
  },

  /* ── Les VERSIONS d'une même unité ────────────────────────────────────────
   *
   * Tout ce qui précède est une release par œuvre, ou presque : la question
   * « laquelle de ces six je prends ? » ne se posait qu'au niveau du film. Or
   * c'est au niveau de l'ÉPISODE qu'elle se pose le plus souvent sur un
   * tracker — plusieurs équipes sortent le même épisode le même soir, en
   * VOSTFR, en VF, en 1080p, en 2160p.
   *
   * Les neuf entrées ci-dessous couvrent les trois portées que
   * `/api/torrents/group` sait distinguer, sous un seul `tmdbId` :
   *
   *   - portée `episode`  : E03 en quatre versions, E04 en deux
   *   - portée `season`   : la saison complète en deux versions
   *   - portée `integral` : un pack sans numéro de saison
   *
   * `season` et `episode` ne sont PAS des champs du formulaire : ils sont
   * analysés depuis le nom de release par `parseReleaseName` (le motif
   * `SxxExx`). D'où des noms scrupuleusement conformes — un nom approximatif
   * ne produit pas une release mal rangée, il produit une release SANS unité,
   * donc invisible dans toutes les vues par portée.
   *
   * L'œuvre est `Pioneer One`, six épisodes sortis en 2010 sous licence
   * CC BY-NC-SA : la première série financée par ses spectateurs et diffusée
   * exclusivement en torrent. Difficile de trouver plus à sa place ici.
   * ────────────────────────────────────────────────────────────────────── */

  {
    key: 'pioneerE03a',
    who: 'founder',
    category: 'series',
    name: 'Pioneer.One.S01E03.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-VODO',
    files: [
      {
        path: 'Pioneer.One.S01E03.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-VODO.mkv',
        length: 1_476_395_008,
      },
    ],
    nfo: mi([
      ['General', [
        ['Complete name', 'Pioneer.One.S01E03.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-VODO.mkv'],
        ['Format', 'Matroska'],
        ['File size', '1.38 GiB'],
        ['Duration', '35 min 12 s'],
        ['Overall bit rate', '5 604 kb/s'],
      ]],
      ['Video', [
        ['Format', 'AVC'],
        ['Format profile', 'High@L4'],
        ['Width', '1 920 pixels'],
        ['Height', '1 080 pixels'],
        ['Frame rate', '23.976 FPS'],
        ['Bit depth', '8 bits'],
        ['Bit rate', '5 400 kb/s'],
        ['Language', 'English'],
      ]],
      ['Audio', [
        ['Format', 'AAC'],
        ['Channel(s)', '2 channels'],
        ['Bit rate', '192 kb/s'],
        ['Language', 'English'],
        ['Default', 'Yes'],
      ]],
      ['Text', [
        ['Format', 'ASS'],
        ['Language', 'French'],
        ['Title', 'VOSTFR'],
        ['Default', 'Yes'],
      ]],
    ]),
    description: `Episode 03 — VODO source, the master the production published.

Community-translated ASS subtitles. No video re-encode.`,
    tmdbId: 'tv/33050',
    tags: 'web-dl, vostfr, creative-commons',
  },
  {
    key: 'pioneerE03b',
    who: 'donator',
    category: 'series',
    name: 'Pioneer.One.S01E03.VOSTFR.1080p.WEBRip.AAC.2.0.x265-NOTAG',
    files: [
      {
        path: 'Pioneer.One.S01E03.VOSTFR.1080p.WEBRip.AAC.2.0.x265-NOTAG.mkv',
        length: 734_003_200,
      },
    ],
    description: `x265 re-encode of the same episode: half the weight, and an untrained eye will not spot it.

Take this one if you are archiving the whole season and 6 × 1.4 GiB will not fit.`,
    tmdbId: 'tv/33050',
    tags: 'webrip, x265, vostfr, creative-commons',
  },
  {
    key: 'pioneerE03c',
    who: 'founder',
    category: 'series',
    name: 'Pioneer.One.S01E03.MULTi.2160p.WEB-DL.DDP5.1.HDR.HEVC-UPSCALE',
    files: [
      {
        path: 'Pioneer.One.S01E03.MULTi.2160p.WEB-DL.DDP5.1.HDR.HEVC-UPSCALE.mkv',
        length: 4_509_715_660,
      },
    ],
    description: `Episode 03 at 2160p HDR10, English and French tracks, DDP 5.1.

Let us be honest: the series was shot on HDV. This is an upscale, and the name says so.`,
    tmdbId: 'tv/33050',
    tags: 'web-dl, hdr, multi, creative-commons',
  },
  {
    key: 'pioneerE03d',
    who: 'donator',
    category: 'series',
    name: 'Pioneer.One.S01E03.VF.1080p.WEB-DL.EAC3.2.0.H.264-QCTeam',
    files: [
      {
        path: 'Pioneer.One.S01E03.VF.1080p.WEB-DL.EAC3.2.0.H.264-QCTeam.mkv',
        length: 1_395_864_371,
      },
    ],
    description: 'French dub only, fan-made, from Quebec. No subtitles.',
    tmdbId: 'tv/33050',
    tags: 'web-dl, vf, creative-commons',
  },
  {
    key: 'pioneerE04a',
    who: 'founder',
    category: 'series',
    name: 'Pioneer.One.S01E04.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-VODO',
    files: [
      {
        path: 'Pioneer.One.S01E04.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-VODO.mkv',
        length: 1_503_238_553,
      },
    ],
    description: 'Episode 04, same processing chain as 03.',
    tmdbId: 'tv/33050',
    tags: 'web-dl, vostfr, creative-commons',
  },
  {
    key: 'pioneerE04b',
    who: 'donator',
    category: 'series',
    name: 'Pioneer.One.S01E04.MULTi.1080p.WEB-DL.DDP2.0.H.264-VARYG',
    files: [
      {
        path: 'Pioneer.One.S01E04.MULTi.1080p.WEB-DL.DDP2.0.H.264-VARYG.mkv',
        length: 1_610_612_736,
      },
    ],
    description: 'Episode 04, bilingual — English and French tracks in one file.',
    tmdbId: 'tv/33050',
    tags: 'web-dl, multi, creative-commons',
  },
  {
    key: 'pioneerS01a',
    who: 'founder',
    category: 'series',
    name: 'Pioneer.One.S01.MULTi.1080p.WEB-DL.x265.10bit.FLAC.2.0-VODO',
    torrentName: 'Pioneer.One.S01.MULTi.1080p.WEB-DL.x265.10bit.FLAC.2.0-VODO',
    files: Array.from({ length: 6 }, (_, i) => ({
      path: `Pioneer.One.S01.MULTi.1080p.WEB-DL.x265.10bit.FLAC.2.0-VODO/Pioneer.One.S01E${String(i + 1).padStart(2, '0')}.MULTi.1080p.WEB-DL.x265.10bit.FLAC.2.0-VODO.mkv`,
      length: 687_194_767 + i * 8_388_608,
    })),
    description: `[b]Season 1, complete[/b] — all six episodes, from the VODO masters.

[list]
[*]x265 10-bit encode, CRF 18, grain preserved.
[*]English FLAC 2.0 and French EAC3 2.0 tracks.
[*]Full and forced subtitles for both.
[/list]`,
    tmdbId: 'tv/33050',
    tags: 'web-dl, x265, multi, full-season, creative-commons',
  },
  {
    key: 'pioneerS01b',
    who: 'donator',
    category: 'series',
    name: 'Pioneer.One.S01.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-VODO',
    torrentName: 'Pioneer.One.S01.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-VODO',
    files: Array.from({ length: 6 }, (_, i) => ({
      path: `Pioneer.One.S01.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-VODO/Pioneer.One.S01E${String(i + 1).padStart(2, '0')}.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-VODO.mkv`,
      length: 1_476_395_008 + i * 4_194_304,
    })),
    description: `The weekly releases bundled as they went out, no re-encode. Heavier than the x265 pack, and posted the same night each episode aired.`,
    tmdbId: 'tv/33050',
    tags: 'web-dl, vostfr, full-season, creative-commons',
  },
  {
    // Sans numéro de saison dans le nom : `parseReleaseName` ne trouve rien,
    // donc `season` reste NULL et la release tombe dans la portée `integral`.
    // C'est le cas qui rend cette portée visible.
    key: 'pioneerIntegral',
    who: 'founder',
    category: 'series',
    name: 'Pioneer One - Integrale MULTi 1080p WEB-DL x265 10bit FLAC-VODO',
    torrentName: 'Pioneer One - Integrale',
    files: Array.from({ length: 6 }, (_, i) => ({
      path: `Pioneer One - Integrale/Pioneer One - ${String(i + 1).padStart(2, '0')}.mkv`,
      length: 687_194_767 + i * 8_388_608,
    })),
    description: `The whole run in one torrent, episodes renamed without any scene convention — the "give me everything and I do not care what it is called" pack.`,
    tmdbId: 'tv/33050',
    tags: 'web-dl, x265, multi, creative-commons',
  },
];

const CATEGORIES = [
  { key: 'films', name: 'Movies', isAdult: false },
  { key: 'series', name: 'Series', isAdult: false },
  { key: 'musique', name: 'Music', isAdult: false },
  { key: 'jeux', name: 'Games', isAdult: false },
  { key: 'livres', name: 'Books', isAdult: false },
  { key: 'adulte', name: 'XXX', isAdult: true },
];

/* ── Les comptes de l'essaim ──────────────────────────────────────────────── */
//
// Un pair est rattaché au membre dont la passkey a servi à l'annonce. Avec les
// trois comptes du seed, un essaim plafonne à trois lignes. Quatre membres de
// plus, inscrits par le VRAI chemin, suffisent à ce qu'un essaim ressemble à
// un essaim.
//
// Le cache disque évite de repayer la preuve de travail à chaque relance.

const SWARM_ACCOUNTS = [
  { username: 'blendhead', email: 'blendhead@e2e.test', password: 'E2e-Passw0rd!blendhead' },
  { username: 'distrohopper', email: 'distrohopper@e2e.test', password: 'E2e-Passw0rd!distro' },
  { username: 'bookworm', email: 'bookworm@e2e.test', password: 'E2e-Passw0rd!bookworm' },
  { username: 'archivist', email: 'archivist@e2e.test', password: 'E2e-Passw0rd!archivist' },
];

const CACHE = new URL('session-torrents.json', HERE);

async function pow() {
  const { body } = await call('/api/auth/pow');
  return solvePoW(body.challenge, body.difficulty, undefined, 240_000);
}

async function register(acc) {
  const jar = jarFor(acc.username);
  const creds = await generateCredentials(acc.password);
  const solved = await pow();
  return call('/api/auth/register', {
    method: 'POST',
    jar,
    body: {
      username: acc.username,
      email: acc.email,
      password: acc.password,
      confirmPassword: acc.password,
      authSalt: creds.salt,
      authVerifier: creds.verifier,
      powChallenge: solved.challenge,
      powNonce: solved.nonce,
      powHash: solved.hash,
    },
  });
}

async function login(acc) {
  const jar = jarFor(acc.username);
  jar.clear();
  const chal = await call(`/api/auth/challenge?username=${encodeURIComponent(acc.username)}`, {
    jar,
  });
  if (!ok(chal.status)) return chal;
  const proof = await generateLoginProof(acc.password, chal.body.salt, chal.body.challenge);
  return call('/api/auth/login', {
    method: 'POST',
    jar,
    body: { username: acc.username, challenge: chal.body.challenge, proof },
  });
}

async function ensureSwarmAccounts() {
  const cached = existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : {};

  // L'inscription se ferme derrière le premier compte enregistré ; le seed l'a
  // rouverte, mais un scénario peut l'avoir refermée depuis.
  await call('/api/admin/settings', {
    method: 'PUT',
    who: 'founder',
    body: { registrationOpen: true },
  });

  const out = {};
  for (const acc of SWARM_ACCOUNTS) {
    if (cached[acc.username]?.cookie) {
      // Le cookie du cache peut appartenir à une pile précédente, détruite
      // depuis : la seule preuve qu'il vaut encore est de s'en servir.
      const jar = jarFor(acc.username);
      jar.clear();
      for (const pair of cached[acc.username].cookie.split('; ')) {
        const i = pair.indexOf('=');
        if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1));
      }
      const who = await call('/api/auth/status', { jar });
      if (who.body?.user?.id) {
        out[acc.username] = { ...cached[acc.username], id: who.body.user.id };
        step(`${acc.username} (cache)`, true);
        continue;
      }
      jar.clear();
    }

    await sleep(2500);
    let r = await register(acc);
    let via = 'register';
    if (!ok(r.status)) {
      r = await login(acc);
      via = 'login';
    }
    if (!ok(r.status)) {
      step(acc.username, false, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      continue;
    }
    const jar = jarFor(acc.username);
    const who = await call('/api/auth/status', { jar });
    out[acc.username] = { cookie: cookieHeader(jar), via, id: who.body?.user?.id ?? null };
    step(`${acc.username} (${via})`, true);
  }
  writeFileSync(CACHE, JSON.stringify(out, null, 2));
  return out;
}

/* ── L'essaim ─────────────────────────────────────────────────────────────── */

/** La passkey d'annonce d'un membre, par le même appel que la page /me. */
async function passkeyOf(who) {
  const { status, body } = await call('/api/auth/passkey', { who });
  return ok(status) ? (body?.passkey ?? null) : null;
}

/* ── Le programme ─────────────────────────────────────────────────────────── */

async function main() {
  if (!S.founder?.cookie) {
    console.error('session.json ne porte pas de founder — lancer run.sh --keep d’abord.');
    process.exit(1);
  }

  console.log('\n1. catégories');
  await resetRateLimits().catch(() => {});
  const catId = {};
  for (const c of CATEGORIES) {
    const made = await call('/api/admin/categories', {
      method: 'POST',
      who: 'founder',
      body: { name: c.name, isAdult: c.isAdult },
    });
    let id = made.body?.id ?? made.body?.category?.id ?? made.body?.data?.id ?? null;
    if (!id) {
      // Déjà là (relance) : la retrouver. `includeAdult` est l'échappatoire du
      // personnel, sans quoi la catégorie XXX est invisible même pour son auteur.
      const { body } = await call('/api/categories?includeAdult=true', { who: 'founder' });
      const list = Array.isArray(body) ? body : (body?.data ?? body?.categories ?? []);
      const flat = list.flatMap((x) => [x, ...(x.subcategories ?? [])]);
      id = flat.find((x) => x.name === c.name)?.id ?? null;
    }
    catId[c.key] = id;
    step(c.name, !!id, id ? '' : JSON.stringify(made.body).slice(0, 120));
  }

  console.log('\n2. comptes de l’essaim');
  const swarmAccounts = await ensureSwarmAccounts();

  console.log('\n3. uploads');
  await resetRateLimits().catch(() => {});
  const rows = {};
  for (const r of RELEASES) {
    const bytes = torrentFile({
      name: r.torrentName ?? r.name,
      files: r.files,
      pieceLength: r.pieceLength,
    });
    const res = await upload(
      r.who,
      {
        name: r.name,
        categoryId: catId[r.category],
        description: r.description,
        nfo: r.nfo,
        tags: r.tags,
        tmdbId: r.tmdbId,
        imdbId: r.imdbId,
        tvdbId: r.tvdbId,
      },
      bytes,
    );
    const row = res.body?.data ?? res.body?.torrent ?? res.body;
    const hash = row?.infoHash ?? null;
    if (hash) {
      rows[r.key] = { ...r, infoHash: hash, size: r.files.reduce((n, f) => n + f.length, 0) };
      step(r.name.slice(0, 60), true, hash.slice(0, 12));
    } else {
      step(r.name.slice(0, 60), false, `${res.status} ${JSON.stringify(res.body).slice(0, 160)}`);
    }
    await sleep(400);
  }

  console.log('\n4. modération');
  await resetRateLimits().catch(() => {});
  for (const r of Object.values(rows)) {
    if (r.keepPending) {
      step(`${r.key} laissé en attente`, true, 'bandeau de modération');
      continue;
    }
    // Un upload du personnel contourne déjà la modération ; approuver un
    // torrent déjà accepté n'est pas une erreur pour cette route.
    const res = await call(`/api/mod/torrents/${r.infoHash}/approve`, {
      method: 'POST',
      who: 'founder',
    });
    step(`${r.key} accepté`, ok(res.status) || res.status === 409, String(res.status));
    await sleep(200);
  }

  console.log('\n5. supersession, buffs, épinglage');
  await resetRateLimits().catch(() => {});
  if (rows.notld1080 && rows.notld1080proper) {
    const res = await call(`/api/mod/torrents/${rows.notld1080.infoHash}/supersede`, {
      method: 'PUT',
      who: 'founder',
      body: {
        supersededById: rows.notld1080proper.infoHash,
        reason: 'VFF désynchronisée d’environ 400 ms à partir du chapitre 12.',
      },
    });
    step('le 1080p est remplacé par le PROPER', ok(res.status), String(res.status));
  }
  if (rows.notld4k) {
    const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const res = await call(`/api/mod/torrents/${rows.notld4k.infoHash}/buffs`, {
      method: 'PUT',
      who: 'founder',
      body: { downloadMultiplier: 0, uploadMultiplier: 100, until, isSticky: true },
    });
    step('freeleech 7 jours + épinglage sur le remux', ok(res.status), String(res.status));
  }
  if (rows.holmes) {
    const res = await call(`/api/mod/torrents/${rows.holmes.infoHash}/buffs`, {
      method: 'PUT',
      who: 'founder',
      body: { uploadMultiplier: 200, until: new Date(Date.now() + 3 * 86_400_000).toISOString() },
    });
    step('x2 upload on Sherlock Holmes S01', ok(res.status), String(res.status));
  }

  console.log('\n6. commentaires');
  await resetRateLimits().catch(() => {});
  const COMMENTS = [
    [
      'notld4k',
      'donator',
      'Best transfer of this film to date. The grain is there, and nobody ran a denoiser over it.',
    ],
    [
      'notld4k',
      'plainuser',
      'Silly question: my TV is SDR only — does the HDR10 tone-map down cleanly?',
    ],
    [
      'notld4k',
      'founder',
      '[quote=plainuser]does the HDR10 tone-map down cleanly?[/quote]\nNot on its own — your player has to do the tone mapping. mpv and VLC will; a cheap HDMI stick often will not. On a black-and-white film the result holds up either way.',
    ],
    [
      'notld4k',
      'blendhead',
      'Seeding since this morning, 64 GiB at 1.2 GiB/s at peak. Thanks for the freeleech.',
    ],
    [
      'notld1080',
      'plainuser',
      'The subtitle drift is genuinely distracting from the cellar scene onward. Take the PROPER.',
    ],
    [
      'holmes',
      'bookworm',
      'Thirty-nine episodes at 1080p and in the public domain — I did not think this existed anywhere. Thank you.',
    ],
    [
      'ghosts',
      'archivist',
      'This really is the 24/96 master from nin.com, not a CD upsample — the spectra run all the way to 48 kHz. Nice touch including the licence file.',
    ],
    [
      'game',
      'distrohopper',
      'Twelve archives, so plan the space: you need about 24 GiB for the download plus unpacking.',
    ],
  ];
  for (const [key, who, content] of COMMENTS) {
    const r = rows[key];
    if (!r) continue;
    if (!S[who] && !swarmAccounts[who]) continue;
    const res = await call(`/api/torrents/${r.infoHash}/comments`, {
      method: 'POST',
      who,
      body: { content },
    });
    step(`${who} sur ${key}`, ok(res.status), String(res.status));
    await sleep(250);
  }

  console.log('\n7. favoris et obligation de seed');
  await resetRateLimits().catch(() => {});
  if (rows.notld4k) {
    for (const who of ['plainuser', 'donator']) {
      const res = await call(`/api/torrents/${rows.notld4k.infoHash}/favorite`, {
        method: 'POST',
        who,
      });
      step(`${who} met le remux en favori`, ok(res.status) || res.status === 409, String(res.status));
    }
    // Le clic sur le .torrent est ce qui pose la ligne `hnr_tracking`. Sans
    // lui, l'annonce qui suit n'a rien à compléter et la carte d'obligation
    // reste absente — c'est le chemin réel, pas un raccourci.
    const dl = await call(`/api/torrents/${rows.notld4k.infoHash}/download`, {
      who: 'plainuser',
      raw: true,
    });
    step('plainuser récupère le .torrent', ok(dl.status), `${dl.buffer?.length ?? 0} octets`);
  }

  console.log('\n8. essaim (annonces réelles)');
  const passkeys = {};
  for (const who of ['founder', 'donator', 'plainuser', ...Object.keys(swarmAccounts)]) {
    const pk = await passkeyOf(who);
    if (pk) passkeys[who] = pk;
  }
  step('passkeys récupérées', Object.keys(passkeys).length > 0, Object.keys(passkeys).join(' '));

  const GiB = 1024 ** 3;
  // Qui est dans quel essaim, et dans quel état. `done: 1` = seeder ;
  // `done < 1` = leecher, et le pourcentage que la page affiche vient de là.
  const SWARM = [
    ['notld4k', 'founder', { done: 1, up: 412 * GiB }],
    ['notld4k', 'blendhead', { done: 1, up: 96 * GiB }],
    ['notld4k', 'distrohopper', { done: 1, up: 11 * GiB }],
    ['notld4k', 'bookworm', { done: 0.34, up: 2 * GiB }],
    ['notld4k', 'archivist', { done: 0.71, up: 8 * GiB }],
    ['notld4k', 'plainuser', { done: 1, up: 0 }],
    ['notld4kXseed', 'donator', { done: 1, up: 4 * GiB }],
    ['notld4kXseed', 'blendhead', { done: 1, up: 19 * GiB }],
    ['notld1080', 'donator', { done: 1, up: 61 * GiB }],
    ['notld1080', 'archivist', { done: 1, up: 3 * GiB }],
    ['notld1080proper', 'founder', { done: 1, up: 22 * GiB }],
    ['notld1080proper', 'blendhead', { done: 1, up: 7 * GiB }],
    ['notld1080proper', 'bookworm', { done: 0.12, up: 0 }],
    ['holmes', 'founder', { done: 1, up: 148 * GiB }],
    ['holmes', 'distrohopper', { done: 1, up: 31 * GiB }],
    ['holmes', 'bookworm', { done: 1, up: 12 * GiB }],
    ['holmes', 'archivist', { done: 0.88, up: 1 * GiB }],
    ['holmes', 'plainuser', { done: 0.05, up: 0 }],
    ['ghosts', 'donator', { done: 1, up: 9 * GiB }],
    ['ghosts', 'archivist', { done: 1, up: 2 * GiB }],
    ['game', 'founder', { done: 1, up: 244 * GiB }],
    ['game', 'distrohopper', { done: 0.46, up: 0 }],
    ['adult', 'founder', { done: 1, up: 1 * GiB }],
    // Les versions : des essaims de tailles TRÈS différentes sur la même
    // unité, parce que c'est ce qui départage deux versions quand la qualité
    // ne suffit pas — le 2160p peut être meilleur et introuvable.
    ['pioneerE03a', 'founder', { done: 1, up: 31 * GiB }],
    ['pioneerE03a', 'blendhead', { done: 1, up: 12 * GiB }],
    ['pioneerE03a', 'distrohopper', { done: 1, up: 4 * GiB }],
    ['pioneerE03a', 'bookworm', { done: 0.62, up: 0 }],
    ['pioneerE03b', 'donator', { done: 1, up: 8 * GiB }],
    ['pioneerE03c', 'founder', { done: 1, up: 2 * GiB }],
    ['pioneerE03d', 'donator', { done: 1, up: 1 * GiB }],
    ['pioneerE04a', 'founder', { done: 1, up: 22 * GiB }],
    ['pioneerE04a', 'archivist', { done: 1, up: 3 * GiB }],
    ['pioneerE04b', 'donator', { done: 1, up: 5 * GiB }],
    ['pioneerS01a', 'founder', { done: 1, up: 184 * GiB }],
    ['pioneerS01a', 'blendhead', { done: 1, up: 41 * GiB }],
    ['pioneerS01a', 'distrohopper', { done: 0.23, up: 0 }],
    ['pioneerS01b', 'donator', { done: 1, up: 96 * GiB }],
    ['pioneerIntegral', 'founder', { done: 1, up: 58 * GiB }],
  ];

  let announced = 0;
  let refused = 0;
  for (const [key, who, spec] of SWARM) {
    const r = rows[key];
    const pk = passkeys[who];
    if (!r || !pk || r.noSwarm) continue;
    const left = Math.round(r.size * (1 - spec.done));
    const port = 6881 + (announced % 64);
    // Deux annonces pour qui a fini : `started` puis `completed`. C'est la
    // seconde qui incrémente le compteur de snatchs et qui ferme la ligne
    // `hnr_tracking` — un seeder posé d'une seule annonce `started` laisse la
    // page dire « jamais complété ».
    const first = await announce(pk, r.infoHash, `${key}:${who}`, {
      left: spec.done >= 1 ? r.size : left,
      uploaded: 0,
      downloaded: spec.done >= 1 ? 0 : r.size - left,
      event: 'started',
      port,
    });
    if (first.failure) {
      refused += 1;
      step(`${who} -> ${key}`, false, first.failure);
      continue;
    }
    if (spec.done >= 1) {
      await announce(pk, r.infoHash, `${key}:${who}`, {
        left: 0,
        uploaded: spec.up,
        downloaded: r.size,
        event: 'completed',
        port,
      });
    }
    announced += 1;
    step(`${who} -> ${key}`, true, spec.done >= 1 ? 'seeder' : `${Math.round(spec.done * 100)} %`);
    await sleep(120);
  }
  step('annonces', refused === 0, `${announced} acceptées, ${refused} refusées`);

  // Le versement des crédits d'octets est groupé (5 s dans cette pile) : sans
  // cette attente, les ratios affichés sont ceux d'avant les annonces.
  console.log('\n   attente du versement des crédits (7 s)…');
  await sleep(7000);

  console.log('\nÀ regarder');
  const link = (key, label) =>
    rows[key] ? console.log(`  ${label.padEnd(34)} ${WEB}/torrents/${rows[key].infoHash}`) : null;
  link('notld4k', 'remux 4K, tout allumé');
  link('notld4kXseed', 'son cross-seed');
  link('notld1080', 'remplacé par un PROPER');
  link('notld1080proper', 'le PROPER');
  link('holmes', 'saison complète, upload x2');
  link('ghosts', 'musique, pistes audio seules');
  link('game', 'jeu, 14 fichiers');
  link('ebook', 'aucun seeder -> demande de reseed');
  link('pending', 'en attente de modération');
  link('adult', 'voile adulte');
  link('pioneerE03a', 'épisode 03, 4 versions');
  link('pioneerS01a', 'saison 1, 2 versions');
  link('pioneerIntegral', 'intégrale, sans saison');
  if (rows.notld4k) {
    console.log(`  ${'groupe (quatre éditions)'.padEnd(34)} ${WEB}/torrents/group/tmdb:10331`);
  }
  if (rows.pioneerE03a) {
    console.log(`  ${'groupe (3 portées)'.padEnd(34)} ${WEB}/torrents/group/tmdb:tv/33050`);
  }
  console.log(`\n  ${steps} étapes, ${problems} en échec.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
