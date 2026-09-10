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

/* ── Les fixtures ─────────────────────────────────────────────────────────── */

const DUNE_ROOT =
  'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR.HEVC.TrueHD.7.1.Atmos-FraMeSToR';

const duneFiles = [
  { path: `${DUNE_ROOT}/${DUNE_ROOT}.mkv`, length: 88_412_913_664 },
  { path: `${DUNE_ROOT}/FraMeSToR.nfo`, length: 12_284 },
  { path: `${DUNE_ROOT}/Sample/sample.mkv`, length: 214_958_080 },
];

const duneNfo = mi([
  ['General', [
    ['Complete name', `${DUNE_ROOT}.mkv`],
    ['Format', 'Matroska'],
    ['File size', '82.3 GiB'],
    ['Duration', '2 h 46 min'],
    ['Overall bit rate', '70.9 Mb/s'],
  ]],
  ['Video', [
    ['Format', 'HEVC'],
    ['Format profile', 'Main 10@L5.1@High'],
    ['Width', '3 840 pixels'],
    ['Height', '2 160 pixels'],
    ['Frame rate', '23.976 FPS'],
    ['Bit depth', '10 bits'],
    ['Bit rate', '61.5 Mb/s'],
    ['Writing library', 'x265'],
    ['Language', 'English'],
    ['Default', 'Yes'],
    ['Forced', 'No'],
  ]],
  ['Audio #1', [
    ['Format', 'MLP FBA 16-ch'],
    ['Commercial name', 'Dolby TrueHD with Dolby Atmos'],
    ['Channel(s)', '8 channels'],
    ['Bit rate', '4 448 kb/s'],
    ['Language', 'English'],
    ['Title', 'TrueHD 7.1 Atmos'],
    ['Default', 'Yes'],
    ['Forced', 'No'],
  ]],
  ['Audio #2', [
    ['Format', 'DTS'],
    ['Commercial name', 'DTS-HD Master Audio'],
    ['Channel(s)', '6 channels'],
    ['Bit rate', '3 018 kb/s'],
    ['Language', 'French'],
    ['Title', 'VFF DTS-HD MA 5.1'],
    ['Default', 'No'],
    ['Forced', 'No'],
  ]],
  ['Audio #3', [
    ['Format', 'E-AC-3'],
    ['Commercial name', 'Dolby Digital Plus'],
    ['Channel(s)', '6 channels'],
    ['Bit rate', '640 kb/s'],
    ['Language', 'Spanish'],
    ['Title', 'Castellano DD+ 5.1'],
    ['Default', 'No'],
    ['Forced', 'No'],
  ]],
  ['Text #1', [
    ['Format', 'UTF-8'],
    ['Language', 'French'],
    ['Title', 'VFF complet'],
    ['Default', 'Yes'],
    ['Forced', 'No'],
  ]],
  ['Text #2', [
    ['Format', 'UTF-8'],
    ['Language', 'French'],
    ['Title', 'VFF forces'],
    ['Default', 'No'],
    ['Forced', 'Yes'],
  ]],
  ['Text #3', [
    ['Format', 'PGS'],
    ['Language', 'English'],
    ['Title', 'English SDH'],
    ['Default', 'No'],
    ['Forced', 'No'],
    ['Hearing impaired', 'Yes'],
  ]],
  ['Text #4', [
    ['Format', 'PGS'],
    ['Language', 'Spanish'],
    ['Default', 'No'],
    ['Forced', 'No'],
  ]],
  ['Text #5', [
    ['Format', 'PGS'],
    ['Language', 'Japanese'],
    ['Default', 'No'],
    ['Forced', 'No'],
  ]],
]);

const duneDescription = `[center][b]DUNE : DEUXIÈME PARTIE[/b] — 2024 — Denis Villeneuve[/center]

[quote]Paul Atreides s'unit à Chani et aux Fremen pour mener la révolte contre ceux qui ont détruit sa famille.[/quote]

[b]Source[/b] : UHD BluRay FR (Warner) — remux intégral, aucun réencodage.
[b]Vidéo[/b] : HEVC 10 bits, Dolby Vision Profile 7 avec repli HDR10, grain préservé.
[b]Audio[/b] : la piste anglaise est la TrueHD 7.1 Atmos d'origine. La VFF est la DTS-HD MA 5.1 du disque français, non recompressée.
[b]Sous-titres[/b] : VFF complets et forcés, anglais SDH, espagnol, japonais.

[b]Notes[/b]
[list]
[*]Les chapitres du disque sont conservés.
[*]Le dossier [i]Sample[/i] contient 90 s tirées de l'arrivée sur Arrakeen.
[*]Merci de rester en seed : c'est 82 Gio, personne ne les récupère en une heure.
[/list]`;

const BEAR_ROOT = 'The.Bear.S03.1080p.WEB-DL.DDP5.1.H.264-NTb';
const bearFiles = Array.from({ length: 10 }, (_, i) => ({
  path: `${BEAR_ROOT}/The.Bear.S03E${String(i + 1).padStart(2, '0')}.1080p.WEB-DL.DDP5.1.H.264-NTb.mkv`,
  length: 1_932_735_283 + i * 41_231_686,
}));

const bearNfo = mi([
  ['General', [
    ['Complete name', 'The.Bear.S03E01.1080p.WEB-DL.DDP5.1.H.264-NTb.mkv'],
    ['Format', 'Matroska'],
    ['File size', '1.80 GiB'],
    ['Duration', '32 min 4 s'],
    ['Overall bit rate', '8 043 kb/s'],
  ]],
  ['Video', [
    ['Format', 'AVC'],
    ['Format profile', 'High@L4'],
    ['Width', '1 920 pixels'],
    ['Height', '1 080 pixels'],
    ['Frame rate', '23.976 FPS'],
    ['Bit depth', '8 bits'],
    ['Bit rate', '7 464 kb/s'],
    ['Language', 'English'],
  ]],
  ['Audio #1', [
    ['Format', 'E-AC-3'],
    ['Commercial name', 'Dolby Digital Plus'],
    ['Channel(s)', '6 channels'],
    ['Bit rate', '640 kb/s'],
    ['Language', 'English'],
    ['Default', 'Yes'],
  ]],
  ['Audio #2', [
    ['Format', 'E-AC-3'],
    ['Channel(s)', '6 channels'],
    ['Bit rate', '640 kb/s'],
    ['Language', 'French'],
    ['Title', 'VF Québec'],
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

const FLAC_ROOT = 'Radiohead - In Rainbows (2007) [FLAC 24-96]';
const flacFiles = [
  ...Array.from({ length: 10 }, (_, i) => ({
    path: `${FLAC_ROOT}/${String(i + 1).padStart(2, '0')} - Track ${i + 1}.flac`,
    length: 68_157_440 + i * 5_242_880,
  })),
  { path: `${FLAC_ROOT}/cover.jpg`, length: 2_411_724 },
  { path: `${FLAC_ROOT}/In Rainbows.log`, length: 8_432 },
];

const flacNfo = mi([
  ['General', [
    ['Complete name', '01 - 15 Step.flac'],
    ['Format', 'FLAC'],
    ['File size', '65.0 MiB'],
    ['Duration', '3 min 57 s'],
    ['Overall bit rate', '2 298 kb/s'],
  ]],
  ['Audio', [
    ['Format', 'FLAC'],
    ['Channel(s)', '2 channels'],
    ['Bit rate', '2 298 kb/s'],
    ['Language', 'English'],
    ['Title', 'Vinyl rip 24 bits / 96 kHz'],
    ['Default', 'Yes'],
  ]],
]);

const GAME_ROOT = "Baldur's Gate 3 v4.1.1.4667176 (GOG)";

/**
 * Ce que ce script dépose.
 *
 * `tmdbId` sert au regroupement de la page (`tmdb:693134` pour les quatre
 * éditions du film) — c'est la seule façon de voir la table des versions
 * autrement que vide.
 */
const RELEASES = [
  {
    key: 'dune4k',
    who: 'founder',
    category: 'films',
    name: DUNE_ROOT,
    files: duneFiles,
    nfo: duneNfo,
    description: duneDescription,
    tmdbId: '693134',
    imdbId: 'tt15239678',
    tags: 'remux, dolby-vision, atmos, vff, science-fiction',
  },
  {
    // Le cross-seed : MÊME liste de fichiers, `piece length` de 8 Mio au lieu
    // de 4 — donc même `content_signature`, info_hash différent. Le nom
    // affiché diffère (c'est le champ `name` du formulaire, pas celui du
    // .torrent), comme quand la même release circule sous deux conventions.
    key: 'dune4kXseed',
    who: 'donator',
    category: 'films',
    name: `${DUNE_ROOT} [pieces 8MiB]`,
    torrentName: DUNE_ROOT,
    files: duneFiles,
    pieceLength: 8 * 1024 * 1024,
    nfo: duneNfo,
    description: `Cross-seed du remux FraMeSToR — contenu identique, découpage en pièces de 8 Mio.

Utile si votre client refuse de re-vérifier 82 Gio pour la version 4 Mio.`,
    tmdbId: '693134',
    tags: 'remux, cross-seed, dolby-vision',
  },
  {
    key: 'dune1080',
    who: 'donator',
    category: 'films',
    name: 'Dune.Part.Two.2024.1080p.BluRay.x264.DTS-HD.MA.5.1-SbR',
    files: [
      {
        path: 'Dune.Part.Two.2024.1080p.BluRay.x264.DTS-HD.MA.5.1-SbR/Dune.Part.Two.2024.1080p.BluRay.x264.DTS-HD.MA.5.1-SbR.mkv',
        length: 18_253_611_008,
      },
      { path: 'Dune.Part.Two.2024.1080p.BluRay.x264.DTS-HD.MA.5.1-SbR/sbr.nfo', length: 4_096 },
    ],
    description: `L'édition 1080p, pour qui n'a pas 82 Gio à donner au film.

[b]Remplacée[/b] par le PROPER : la VFF de cette version est désynchronisée d'environ 400 ms à partir du chapitre 12.`,
    tmdbId: '693134',
    tags: 'x264, vff, science-fiction',
  },
  {
    key: 'dune1080proper',
    who: 'founder',
    category: 'films',
    name: 'Dune.Part.Two.2024.PROPER.1080p.BluRay.x264.DTS-HD.MA.5.1-SbR',
    files: [
      {
        path: 'Dune.Part.Two.2024.PROPER.1080p.BluRay.x264.DTS-HD.MA.5.1-SbR/Dune.Part.Two.2024.PROPER.1080p.BluRay.x264.DTS-HD.MA.5.1-SbR.mkv',
        length: 18_254_659_584,
      },
      {
        path: 'Dune.Part.Two.2024.PROPER.1080p.BluRay.x264.DTS-HD.MA.5.1-SbR/sbr.nfo',
        length: 4_112,
      },
    ],
    description:
      'PROPER : la piste VFF est resynchronisée. Le reste est identique bit pour bit.',
    tmdbId: '693134',
    tags: 'x264, proper, vff',
  },
  {
    key: 'bear',
    who: 'founder',
    category: 'series',
    name: BEAR_ROOT,
    files: bearFiles,
    nfo: bearNfo,
    description: `[b]The Bear[/b] — saison 3 complète, 10 épisodes, WEB-DL Disney+ FR.

[list]
[*]Piste anglaise DDP 5.1 d'origine.
[*]VF québécoise incluse, même débit.
[*]Sous-titres français et anglais SDH, extraits du flux, non OCR.
[/list]

[b]Upload ×2 jusqu'à dimanche[/b] — la saison 4 sort la semaine suivante et l'essaim va se vider.`,
    tvdbId: '387662',
    tags: 'web-dl, saison-complete, vf, comedie',
  },
  {
    key: 'flac',
    who: 'donator',
    category: 'musique',
    name: 'Radiohead - In Rainbows (2007) [FLAC 24-96 Vinyl]',
    torrentName: FLAC_ROOT,
    files: flacFiles,
    nfo: flacNfo,
    description: `Rip vinyle 24 bits / 96 kHz, platine Technics SL-1200GR + Ortofon 2M Black.

[b]Chaîne[/b] : préampli Rega Fono MM → RME ADI-2 Pro → FLAC niveau 8, sans normalisation ni declic automatique.
[b]Log[/b] : inclus dans le dossier.

Le pressage 2016 (XLLP 2007) — pas la réédition 2021, qui est un report du CD.`,
    tags: 'flac, 24bit, vinyle, rock',
  },
  {
    key: 'game',
    who: 'founder',
    category: 'jeux',
    name: "Baldur's Gate 3 v4.1.1.4667176 (GOG) + All DLCs",
    torrentName: GAME_ROOT,
    files: [
      {
        path: `${GAME_ROOT}/setup_baldurs_gate_3_4.1.1.4667176_(64bit)_(78334).exe`,
        length: 4_294_967_296,
      },
      ...Array.from({ length: 27 }, (_, i) => ({
        path: `${GAME_ROOT}/setup_baldurs_gate_3_4.1.1.4667176_(64bit)_(78334)-${i + 1}.bin`,
        length: 4_294_967_296,
      })),
    ],
    description: `Installeur GOG hors-ligne, patch 8 (v4.1.1.4667176). Aucun crack : la version GOG n'a pas de DRM.

[b]Contenu[/b] : jeu de base + Digital Deluxe Edition DLC.
[b]Langues[/b] : toutes celles du dépôt GOG, dont la VF intégrale (textes et voix).
[b]Installation[/b] : lancer le [i].exe[/i], les [i].bin[/i] sont lus automatiquement.`,
    tags: 'gog, drm-free, rpg, vf',
  },
  {
    key: 'ebook',
    who: 'plainuser',
    category: 'livres',
    name: 'Frank Herbert - Le Cycle de Dune (6 tomes) [EPUB]',
    torrentName: 'Frank Herbert - Le Cycle de Dune',
    files: Array.from({ length: 6 }, (_, i) => ({
      path: `Frank Herbert - Le Cycle de Dune/Tome ${i + 1}.epub`,
      length: 1_048_576 + i * 262_144,
    })),
    description: `Les six romans de Frank Herbert, traduction Michel Demuth revue (Robert Laffont, collection Ailleurs & Demain).

EPUB 3, sans DRM, table des matières et notes de bas de page conservées.`,
    tags: 'epub, science-fiction, vf',
    // Personne n'annonce : c'est le torrent sans seeder, qui fait apparaître
    // la demande de reseed sur la page.
    noSwarm: true,
  },
  {
    key: 'pending',
    who: 'plainuser',
    category: 'films',
    name: 'Sicario.2015.1080p.BluRay.x265.10bit.AAC5.1-YOLO',
    files: [
      {
        path: 'Sicario.2015.1080p.BluRay.x265.10bit.AAC5.1-YOLO/Sicario.2015.1080p.x265-YOLO.mkv',
        length: 2_147_483_648,
      },
    ],
    description: 'Encodage maison x265, CRF 20, preset slow. Audio en AAC 5.1 à 448 kb/s.',
    tmdbId: '242582',
    tags: 'x265, encodage-maison',
    // Laissé en attente : c'est ce qui rend visible le bandeau de modération
    // sur la page, pour son auteur et pour le personnel.
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
      "Fixture de catégorie adulte. Elle n'existe que pour vérifier le voile de la page de détail et le réglage « afficher le contenu adulte ».",
    tags: 'web-dl',
  },

  /* ── Les VERSIONS d'une même unité ────────────────────────────────────────
   *
   * Tout ce qui précède est une release par œuvre, ou presque : la question
   * « laquelle de ces six je prends ? » ne se posait qu'au niveau du film. Or
   * c'est au niveau de l'ÉPISODE qu'elle se pose le plus souvent sur un
   * tracker d'animation — quatre équipes sortent le même épisode le même
   * soir, en VOSTFR, en VF, en 1080p, en 2160p.
   *
   * Les neuf entrées ci-dessous couvrent les trois portées que
   * `/api/torrents/group` sait distinguer, sous un seul `tmdbId` :
   *
   *   - portée `episode`  : E09 en quatre versions, E10 en deux
   *   - portée `season`   : la saison complète en deux versions
   *   - portée `integral` : un pack sans numéro de saison
   *
   * `season` et `episode` ne sont PAS des champs du formulaire : ils sont
   * analysés depuis le nom de release par `parseReleaseName` (le motif
   * `SxxExx`). D'où des noms scrupuleusement conformes — un nom approximatif
   * ne produit pas une release mal rangée, il produit une release SANS unité,
   * donc invisible dans toutes les vues par portée.
   * ────────────────────────────────────────────────────────────────────── */

  {
    key: 'frierenE09a',
    who: 'founder',
    category: 'series',
    name: 'Sousou.no.Frieren.S01E09.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws',
    files: [
      {
        path: 'Sousou.no.Frieren.S01E09.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws.mkv',
        length: 1_476_395_008,
      },
    ],
    nfo: mi([
      ['General', [
        ['Complete name', 'Sousou.no.Frieren.S01E09.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws.mkv'],
        ['Format', 'Matroska'],
        ['File size', '1.38 GiB'],
        ['Duration', '23 min 40 s'],
        ['Overall bit rate', '8 312 kb/s'],
      ]],
      ['Video', [
        ['Format', 'AVC'],
        ['Format profile', 'High@L4'],
        ['Width', '1 920 pixels'],
        ['Height', '1 080 pixels'],
        ['Frame rate', '23.976 FPS'],
        ['Bit depth', '8 bits'],
        ['Bit rate', '8 000 kb/s'],
        ['Language', 'Japanese'],
      ]],
      ['Audio', [
        ['Format', 'AAC'],
        ['Channel(s)', '2 channels'],
        ['Bit rate', '192 kb/s'],
        ['Language', 'Japanese'],
        ['Default', 'Yes'],
      ]],
      ['Text', [
        ['Format', 'ASS'],
        ['Language', 'French'],
        ['Title', 'VOSTFR'],
        ['Default', 'Yes'],
      ]],
    ]),
    description: `Épisode 09 — sortie du soir, source Crunchyroll FR.

Sous-titres ASS avec styles et karaoké sur l'opening. Aucun réencodage vidéo.`,
    tmdbId: 'tv/209867',
    tags: 'web-dl, vostfr, anime',
  },
  {
    key: 'frierenE09b',
    who: 'donator',
    category: 'series',
    name: 'Sousou.no.Frieren.S01E09.VOSTFR.1080p.WEBRip.AAC.2.0.x265-NOTAG',
    files: [
      {
        path: 'Sousou.no.Frieren.S01E09.VOSTFR.1080p.WEBRip.AAC.2.0.x265-NOTAG.mkv',
        length: 734_003_200,
      },
    ],
    description: `Réencodage x265 du même épisode : la moitié du poids pour un œil non exercé.

À prendre si vous archivez la saison entière et que 24 × 1,4 Gio ne passe pas.`,
    tmdbId: 'tv/209867',
    tags: 'webrip, x265, vostfr, anime',
  },
  {
    key: 'frierenE09c',
    who: 'founder',
    category: 'series',
    name: 'Sousou.no.Frieren.S01E09.MULTi.2160p.WEB-DL.DDP5.1.HDR.HEVC-FLUX',
    files: [
      {
        path: 'Sousou.no.Frieren.S01E09.MULTi.2160p.WEB-DL.DDP5.1.HDR.HEVC-FLUX.mkv',
        length: 4_509_715_660,
      },
    ],
    description: `L'épisode 09 en 2160p HDR10, pistes japonaise et française, DDP 5.1.

Le seul upscale du lot est celui de la plateforme elle-même — la source n'existe pas en 4K natif.`,
    tmdbId: 'tv/209867',
    tags: 'web-dl, hdr, multi, anime',
  },
  {
    key: 'frierenE09d',
    who: 'donator',
    category: 'series',
    name: 'Sousou.no.Frieren.S01E09.VF.1080p.WEB-DL.EAC3.2.0.H.264-QCTeam',
    files: [
      {
        path: 'Sousou.no.Frieren.S01E09.VF.1080p.WEB-DL.EAC3.2.0.H.264-QCTeam.mkv',
        length: 1_395_864_371,
      },
    ],
    description: 'Version française uniquement, doublage québécois. Aucun sous-titre.',
    tmdbId: 'tv/209867',
    tags: 'web-dl, vf, anime',
  },
  {
    key: 'frierenE10a',
    who: 'founder',
    category: 'series',
    name: 'Sousou.no.Frieren.S01E10.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws',
    files: [
      {
        path: 'Sousou.no.Frieren.S01E10.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws.mkv',
        length: 1_503_238_553,
      },
    ],
    description: 'Épisode 10, même chaîne de traitement que le 09.',
    tmdbId: 'tv/209867',
    tags: 'web-dl, vostfr, anime',
  },
  {
    key: 'frierenE10b',
    who: 'donator',
    category: 'series',
    name: 'Sousou.no.Frieren.S01E10.MULTi.1080p.WEB-DL.DDP2.0.H.264-VARYG',
    files: [
      {
        path: 'Sousou.no.Frieren.S01E10.MULTi.1080p.WEB-DL.DDP2.0.H.264-VARYG.mkv',
        length: 1_610_612_736,
      },
    ],
    description: 'Épisode 10 bilingue, pistes japonaise et française dans le même fichier.',
    tmdbId: 'tv/209867',
    tags: 'web-dl, multi, anime',
  },
  {
    key: 'frierenS01a',
    who: 'founder',
    category: 'series',
    name: 'Sousou.no.Frieren.S01.MULTi.1080p.BluRay.x265.10bit.FLAC.2.0-KAWAII',
    torrentName: 'Sousou.no.Frieren.S01.MULTi.1080p.BluRay.x265.10bit.FLAC.2.0-KAWAII',
    files: Array.from({ length: 28 }, (_, i) => ({
      path: `Sousou.no.Frieren.S01.MULTi.1080p.BluRay.x265.10bit.FLAC.2.0-KAWAII/Sousou.no.Frieren.S01E${String(i + 1).padStart(2, '0')}.MULTi.1080p.BluRay.x265.10bit.FLAC.2.0-KAWAII.mkv`,
      length: 687_194_767 + i * 8_388_608,
    })),
    description: `[b]Saison 1 complète[/b] — 28 épisodes, source BluRay japonais.

[list]
[*]Encodage x265 10 bits, CRF 18, grain préservé.
[*]Pistes japonaise FLAC 2.0 et française EAC3 2.0.
[*]Sous-titres VOSTFR et VF forcés.
[/list]`,
    tmdbId: 'tv/209867',
    tags: 'bluray, x265, multi, saison-complete, anime',
  },
  {
    key: 'frierenS01b',
    who: 'donator',
    category: 'series',
    name: 'Sousou.no.Frieren.S01.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws',
    torrentName: 'Sousou.no.Frieren.S01.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws',
    files: Array.from({ length: 28 }, (_, i) => ({
      path: `Sousou.no.Frieren.S01.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws/Sousou.no.Frieren.S01E${String(i + 1).padStart(2, '0')}.VOSTFR.1080p.WEB-DL.AAC.2.0.H.264-TsundereRaws.mkv`,
      length: 1_476_395_008 + i * 4_194_304,
    })),
    description: `Le pack des sorties hebdomadaires, sans réencodage. Plus lourd que la version BluRay et sorti six mois plus tôt.`,
    tmdbId: 'tv/209867',
    tags: 'web-dl, vostfr, saison-complete, anime',
  },
  {
    // Sans numéro de saison dans le nom : `parseReleaseName` ne trouve rien,
    // donc `season` reste NULL et la release tombe dans la portée `integral`.
    // C'est le cas qui rend cette portée visible.
    key: 'frierenIntegral',
    who: 'founder',
    category: 'series',
    name: 'Sousou no Frieren - Integrale MULTi 1080p BluRay x265 10bit FLAC-KAWAII',
    torrentName: 'Sousou no Frieren - Integrale',
    files: Array.from({ length: 28 }, (_, i) => ({
      path: `Sousou no Frieren - Integrale/Frieren - ${String(i + 1).padStart(2, '0')}.mkv`,
      length: 687_194_767 + i * 8_388_608,
    })),
    description: `L'intégrale en un seul torrent, épisodes renommés sans convention de scène — le pack « je veux tout et je m'en fous du nommage ».`,
    tmdbId: 'tv/209867',
    tags: 'bluray, x265, multi, anime',
  },
];

const CATEGORIES = [
  { key: 'films', name: 'Films', isAdult: false },
  { key: 'series', name: 'Séries', isAdult: false },
  { key: 'musique', name: 'Musique', isAdult: false },
  { key: 'jeux', name: 'Jeux', isAdult: false },
  { key: 'livres', name: 'Livres', isAdult: false },
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
  { username: 'mando', email: 'mando@e2e.test', password: 'E2e-Passw0rd!mando' },
  { username: 'shai_hulud', email: 'shai@e2e.test', password: 'E2e-Passw0rd!shai' },
  { username: 'harkonnen', email: 'harko@e2e.test', password: 'E2e-Passw0rd!harko' },
  { username: 'bene_gesserit', email: 'bene@e2e.test', password: 'E2e-Passw0rd!bene' },
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
  if (rows.dune1080 && rows.dune1080proper) {
    const res = await call(`/api/mod/torrents/${rows.dune1080.infoHash}/supersede`, {
      method: 'PUT',
      who: 'founder',
      body: {
        supersededById: rows.dune1080proper.infoHash,
        reason: 'VFF désynchronisée d’environ 400 ms à partir du chapitre 12.',
      },
    });
    step('le 1080p est remplacé par le PROPER', ok(res.status), String(res.status));
  }
  if (rows.dune4k) {
    const until = new Date(Date.now() + 7 * 86_400_000).toISOString();
    const res = await call(`/api/mod/torrents/${rows.dune4k.infoHash}/buffs`, {
      method: 'PUT',
      who: 'founder',
      body: { downloadMultiplier: 0, uploadMultiplier: 100, until, isSticky: true },
    });
    step('freeleech 7 jours + épinglage sur le remux', ok(res.status), String(res.status));
  }
  if (rows.bear) {
    const res = await call(`/api/mod/torrents/${rows.bear.infoHash}/buffs`, {
      method: 'PUT',
      who: 'founder',
      body: { uploadMultiplier: 200, until: new Date(Date.now() + 3 * 86_400_000).toISOString() },
    });
    step('upload ×2 sur The Bear S03', ok(res.status), String(res.status));
  }

  console.log('\n6. commentaires');
  const COMMENTS = [
    [
      'dune4k',
      'donator',
      'Le meilleur remux du film à ce jour. La VFF est bien celle du disque français, pas un upmix.',
    ],
    [
      'dune4k',
      'plainuser',
      'Question bête : mon téléviseur ne fait que du HDR10, est-ce que le Dolby Vision Profile 7 se replie correctement ?',
    ],
    [
      'dune4k',
      'founder',
      '[quote=plainuser]est-ce que le Dolby Vision Profile 7 se replie correctement ?[/quote]\nOui — le profil 7 embarque la couche HDR10 de base. Ton téléviseur lira le HDR10 et ignorera la couche RPU.',
    ],
    ['dune4k', 'mando', 'En seed depuis ce matin, 82 Gio à 1,2 Gio/s en pointe. Merci pour le freeleech.'],
    [
      'dune1080',
      'plainuser',
      'Le décalage de la VFF est franchement audible à partir de la scène du ver. Prenez le PROPER.',
    ],
    ['bear', 'harkonnen', 'La VF québécoise est un vrai plus, on ne la trouve nulle part ailleurs.'],
    ['flac', 'bene_gesserit', 'Le log est propre et le rip ne montre aucun declic. Beau travail.'],
    [
      'game',
      'shai_hulud',
      '27 fichiers .bin, prévoyez la place : il faut ~120 Gio pour l’archive plus l’installation.',
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
  if (rows.dune4k) {
    for (const who of ['plainuser', 'donator']) {
      const res = await call(`/api/torrents/${rows.dune4k.infoHash}/favorite`, {
        method: 'POST',
        who,
      });
      step(`${who} met le remux en favori`, ok(res.status) || res.status === 409, String(res.status));
    }
    // Le clic sur le .torrent est ce qui pose la ligne `hnr_tracking`. Sans
    // lui, l'annonce qui suit n'a rien à compléter et la carte d'obligation
    // reste absente — c'est le chemin réel, pas un raccourci.
    const dl = await call(`/api/torrents/${rows.dune4k.infoHash}/download`, {
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
    ['dune4k', 'founder', { done: 1, up: 412 * GiB }],
    ['dune4k', 'mando', { done: 1, up: 96 * GiB }],
    ['dune4k', 'shai_hulud', { done: 1, up: 11 * GiB }],
    ['dune4k', 'harkonnen', { done: 0.34, up: 2 * GiB }],
    ['dune4k', 'bene_gesserit', { done: 0.71, up: 8 * GiB }],
    ['dune4k', 'plainuser', { done: 1, up: 0 }],
    ['dune4kXseed', 'donator', { done: 1, up: 4 * GiB }],
    ['dune4kXseed', 'mando', { done: 1, up: 19 * GiB }],
    ['dune1080', 'donator', { done: 1, up: 61 * GiB }],
    ['dune1080', 'bene_gesserit', { done: 1, up: 3 * GiB }],
    ['dune1080proper', 'founder', { done: 1, up: 22 * GiB }],
    ['dune1080proper', 'mando', { done: 1, up: 7 * GiB }],
    ['dune1080proper', 'harkonnen', { done: 0.12, up: 0 }],
    ['bear', 'founder', { done: 1, up: 148 * GiB }],
    ['bear', 'shai_hulud', { done: 1, up: 31 * GiB }],
    ['bear', 'harkonnen', { done: 1, up: 12 * GiB }],
    ['bear', 'bene_gesserit', { done: 0.88, up: 1 * GiB }],
    ['bear', 'plainuser', { done: 0.05, up: 0 }],
    ['flac', 'donator', { done: 1, up: 9 * GiB }],
    ['flac', 'bene_gesserit', { done: 1, up: 2 * GiB }],
    ['game', 'founder', { done: 1, up: 244 * GiB }],
    ['game', 'shai_hulud', { done: 0.46, up: 0 }],
    ['adult', 'founder', { done: 1, up: 1 * GiB }],
    // Les versions : des essaims de tailles TRÈS différentes sur la même
    // unité, parce que c'est ce qui départage deux versions quand la qualité
    // ne suffit pas — le 2160p peut être meilleur et introuvable.
    ['frierenE09a', 'founder', { done: 1, up: 31 * GiB }],
    ['frierenE09a', 'mando', { done: 1, up: 12 * GiB }],
    ['frierenE09a', 'shai_hulud', { done: 1, up: 4 * GiB }],
    ['frierenE09a', 'harkonnen', { done: 0.62, up: 0 }],
    ['frierenE09b', 'donator', { done: 1, up: 8 * GiB }],
    ['frierenE09c', 'founder', { done: 1, up: 2 * GiB }],
    ['frierenE09d', 'donator', { done: 1, up: 1 * GiB }],
    ['frierenE10a', 'founder', { done: 1, up: 22 * GiB }],
    ['frierenE10a', 'bene_gesserit', { done: 1, up: 3 * GiB }],
    ['frierenE10b', 'donator', { done: 1, up: 5 * GiB }],
    ['frierenS01a', 'founder', { done: 1, up: 184 * GiB }],
    ['frierenS01a', 'mando', { done: 1, up: 41 * GiB }],
    ['frierenS01a', 'shai_hulud', { done: 0.23, up: 0 }],
    ['frierenS01b', 'donator', { done: 1, up: 96 * GiB }],
    ['frierenIntegral', 'founder', { done: 1, up: 58 * GiB }],
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
  link('dune4k', 'remux 4K, tout allumé');
  link('dune4kXseed', 'son cross-seed');
  link('dune1080', 'remplacé par un PROPER');
  link('dune1080proper', 'le PROPER');
  link('bear', 'saison complète, upload x2');
  link('flac', 'musique, pistes audio seules');
  link('game', 'jeu, 28 fichiers');
  link('ebook', 'aucun seeder -> demande de reseed');
  link('pending', 'en attente de modération');
  link('adult', 'voile adulte');
  link('frierenE09a', 'épisode 09, 4 versions');
  link('frierenS01a', 'saison 1, 2 versions');
  link('frierenIntegral', 'intégrale, sans saison');
  if (rows.dune4k) {
    console.log(`  ${'groupe (quatre éditions)'.padEnd(34)} ${WEB}/torrents/group/tmdb:693134`);
  }
  if (rows.frierenE09a) {
    console.log(`  ${'groupe (3 portées)'.padEnd(34)} ${WEB}/torrents/group/tmdb:tv/209867`);
  }
  console.log(`\n  ${steps} étapes, ${problems} en échec.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
