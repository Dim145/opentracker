/**
 * Remplir le forum et la file de tickets d'une pile gardée.
 *
 * `demo.mjs` fabrique les comptes, les rôles et la messagerie ; il ne touche ni
 * au forum ni aux tickets, qui restaient donc vides — et deux surfaces vides ne
 * se testent pas. Ce script les peuple.
 *
 *   node tests/e2e/forumTickets.mjs
 *
 * Tout passe par HTTP, comme `seed.mjs` et `demo.mjs` : pas un raccourci SQL,
 * donc ce que l'on regarde ensuite est bien ce que l'application produit —
 * y compris le premier message d'un sujet, que la route crée dans la même
 * transaction, et le compteur de réponses qu'elle tient à jour.
 *
 * Ce qu'il construit :
 *
 *   forum    trois catégories, six sujets, des réponses de plusieurs membres,
 *            un sujet épinglé et un sujet verrouillé
 *   tickets  les cinq catégories représentées, dans les trois états visibles —
 *            ouvert sans réponse, en cours avec des allers-retours et un
 *            assigné, clos résolu et clos rejeté
 *
 * Rejouable : les catégories déjà présentes sont réutilisées, et une seconde
 * exécution ajoute une nouvelle salve de sujets et de tickets plutôt que
 * d'échouer.
 */
import { API, caller, resetRateLimits, sessions, sleep } from './lib.mjs';

const S = sessions(['founder', 'donator', 'plainuser']);
const req = caller(S);

// Les comptes que `demo.mjs` ajoute. Absents si on n'a lancé que `seed.mjs`,
// auquel cas on se rabat sur les trois du seed — le script reste utile seul.
const HAS = (who) => !!S[who]?.cookie;
const MEMBERS = ['plainuser', 'donator', 'seedersam', 'lurkerlou'].filter(HAS);
const STAFF = ['founder', 'adminalex', 'modmaria'].filter(HAS);
const say = (s) => console.log(`\n\x1b[1m▸ ${s}\x1b[0m`);
const line = (ok, what, detail = '') =>
  console.log(`  ${ok ? '·' : '✗'} ${what}${detail ? '  ' + detail : ''}`);

/** Une salve d'écritures dépasse le seau `mutation` ; on souffle entre les phases. */
async function phase(name, fn) {
  await resetRateLimits();
  say(name);
  await fn();
}

// ── Forum ────────────────────────────────────────────────────────────

const CATEGORIES = [
  {
    name: 'Annonces',
    description: "Ce que le staff publie et que personne n'a le droit d'ignorer.",
    color: '#c2410c',
    icon: 'ph:megaphone',
    order: 0,
  },
  {
    name: 'Entraide',
    description: 'Un client qui ne veut pas seeder, un ratio qui ne monte pas.',
    color: '#0e7490',
    icon: 'ph:lifebuoy',
    order: 1,
  },
  {
    name: 'Discussions',
    description: 'Le reste : ce qu’on regarde, ce qu’on cherche, ce qu’on aime.',
    color: '#4d7c0f',
    icon: 'ph:chats-circle',
    order: 2,
  },
];

/** Les sujets, par nom de catégorie. `by` tourne sur les comptes disponibles. */
const TOPICS = {
  Annonces: [
    {
      title: 'Règlement : les trois choses qui font bannir',
      content:
        "Le ratio n'en fait pas partie. Ce qui fait bannir : truquer les annonces, " +
        'partager son passkey, et revendre une invitation. Le reste se discute.',
      by: 'staff',
      pin: true,
      replies: [
        ['member', 'Merci pour la clarté. Une question sur le partage de passkey en famille ?'],
        ['staff', 'Même foyer, même IP : toléré. Deux villes différentes : non.'],
      ],
    },
    {
      title: 'Maintenance de la base — samedi 06h UTC',
      content:
        "Une heure d'indisponibilité prévue. Les annonces continueront d'être " +
        'acceptées, seul le site sera coupé.',
      by: 'staff',
      lock: true,
      replies: [],
    },
  ],
  Entraide: [
    {
      title: 'Mon client annonce mais le tracker me voit hors ligne',
      content:
        "Transmission 4.0, port 6881 ouvert, et pourtant je n'apparais pas dans le " +
        "swarm. J'ai vérifié le passkey deux fois.",
      by: 'member',
      replies: [
        ['member', "Vérifie que tu n'as pas deux clients sur le même torrent avec deux peer_id."],
        ['staff', "Ton passkey a été régénéré il y a deux jours — reprends le .torrent."],
        ['member', "C'était ça. Merci, je remets le fichier à jour partout."],
      ],
    },
    {
      title: 'Comment lire les colonnes S / L / C du catalogue ?',
      content:
        'Seeders, leechers, et la troisième ? Je devine « completed » mais je préfère demander.',
      by: 'member',
      replies: [['staff', "C'est bien ça : le nombre de téléchargements achevés depuis toujours."]],
    },
  ],
  Discussions: [
    {
      title: 'Ce que vous avez découvert ici et que vous auriez raté ailleurs',
      content:
        "Un tracker privé, c'est aussi une bibliothèque. Racontez la trouvaille que " +
        'vous ne cherchiez pas.',
      by: 'member',
      replies: [
        ['member', "Un documentaire de 1974 sur les barrages, en 4K, remasterisé par un membre."],
        ['member', 'La discographie complète d’un label suisse dont je ne connaissais rien.'],
        ['staff', 'Ce fil mérite d’être épinglé un jour. On y pense.'],
      ],
    },
    {
      title: 'Vos réglages de seedbox, sans les chiffres marketing',
      content:
        'Combien de torrents en parallèle avant que ça se dégrade ? Chez moi, 400.',
      by: 'member',
      replies: [['member', 'Deux cents, mais mon disque est mécanique.']],
    },
  ],
};

let mi = 0;
let si = 0;
/** Tourne sur les membres / le staff pour que les fils ne soient pas monologues. */
const nextMember = () => MEMBERS[mi++ % MEMBERS.length];
const nextStaff = () => STAFF[si++ % STAFF.length];
const who = (kind) => (kind === 'staff' ? nextStaff() : nextMember());

async function seedForum() {
  const existing = await req('founder', '/api/forum/categories');
  const byName = new Map(
    (Array.isArray(existing.body) ? existing.body : (existing.body?.data ?? [])).map(
      (c) => [c.name, c.id],
    ),
  );

  for (const cat of CATEGORIES) {
    if (byName.has(cat.name)) {
      line(true, `catégorie réutilisée`, cat.name);
      continue;
    }
    const r = await req('founder', '/api/forum/categories', { method: 'POST', body: cat });
    const id = r.body?.id ?? r.body?.data?.id;
    if (r.status >= 300 || !id) {
      line(false, `catégorie ${cat.name}`, `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
      continue;
    }
    byName.set(cat.name, id);
    line(true, 'catégorie créée', cat.name);
  }

  // Les titres déjà en ligne, pour qu'une seconde exécution n'ajoute pas six
  // sujets identiques.
  //
  // Lus catégorie par catégorie, et non depuis `/api/forum/stats` : `latest` y
  // est plafonné à cinq entrées, si bien que le sixième sujet passait au
  // travers du garde et se dupliquait à chaque relance. Un plafond invisible
  // dans une liste « les derniers » est exactement le genre de détail qu'on ne
  // remarque qu'après coup.
  const seen = new Set();
  for (const id of byName.values()) {
    const detail = await req('founder', `/api/forum/categories/${id}`);
    for (const t of detail.body?.topics ?? []) {
      if (t?.title) seen.add(t.title);
    }
  }

  for (const [catName, topics] of Object.entries(TOPICS)) {
    const categoryId = byName.get(catName);
    if (!categoryId) {
      line(false, `sujets de ${catName}`, 'catégorie absente');
      continue;
    }
    for (const t of topics) {
      if (seen.has(t.title)) {
        line(true, 'sujet déjà présent', t.title.slice(0, 50));
        continue;
      }
      const author = who(t.by);
      const r = await req(author, '/api/forum/topics', {
        method: 'POST',
        body: { title: t.title, content: t.content, categoryId },
      });
      const topicId = r.body?.id ?? r.body?.data?.id ?? r.body?.topic?.id;
      if (r.status >= 300 || !topicId) {
        line(false, t.title.slice(0, 44), `${r.status} ${JSON.stringify(r.body).slice(0, 120)}`);
        continue;
      }
      line(true, `${author} ouvre`, t.title.slice(0, 52));

      for (const [kind, content] of t.replies) {
        const replier = who(kind);
        const p = await req(replier, '/api/forum/posts', {
          method: 'POST',
          body: { topicId, content },
        });
        line(p.status < 300, `  ${replier} répond`, p.status < 300 ? '' : String(p.status));
        await sleep(60);
      }

      if (t.pin) {
        const r2 = await req('founder', `/api/forum/topics/${topicId}/pin`, {
          method: 'PUT',
          body: { isPinned: true },
        });
        line(r2.status < 300, '  épinglé', r2.status < 300 ? '' : String(r2.status));
      }
      if (t.lock) {
        const r3 = await req('founder', `/api/forum/topics/${topicId}/lock`, {
          method: 'PUT',
          body: { isLocked: true },
        });
        line(r3.status < 300, '  verrouillé', r3.status < 300 ? '' : String(r3.status));
      }
      await sleep(80);
    }
  }
}

// ── Tickets ──────────────────────────────────────────────────────────

const TICKETS = [
  {
    category: 'appeal',
    subject: 'Contestation : bannissement pour hit-and-run',
    body:
      "J'ai été banni pour trois hit-and-run. Deux sont dus à une coupure de fibre de " +
      'quatre jours chez moi, dont j’ai la trace. Je peux fournir le relevé.',
    thread: [
      ['staff', 'Envoyez le relevé, on regarde. Le compte reste suspendu en attendant.'],
      ['member', 'Voici les dates de coupure : du 4 au 8. Le troisième, je le reconnais.'],
    ],
    close: { reason: 'resolved', note: 'Deux H&R annulés, le troisième maintenu. Compte rouvert.' },
  },
  {
    category: 'upload',
    subject: 'Mon upload est refusé sans motif visible',
    body:
      "J'ai proposé un remux 1080p hier, la fiche disparaît de mes envois et je ne " +
      'trouve aucun message. Est-ce un doublon ?',
    thread: [
      ['staff', "C'est bien un doublon : la même source est en ligne depuis mars, en meilleure qualité."],
    ],
    assign: true,
  },
  {
    category: 'bug',
    subject: 'Les recherches enregistrées ne se rejouent pas',
    body:
      "Je clique sur la loupe d'une recherche enregistrée et j'atterris sur le " +
      'catalogue entier, sans aucun filtre appliqué. Testé sur deux navigateurs.',
    thread: [
      ['staff', 'Reproduit. Le lien construit ne portait pas les bons paramètres — corrigé.'],
      ['member', 'Confirmé de mon côté, merci.'],
    ],
    close: { reason: 'resolved', note: 'Noms de paramètres corrigés côté client.' },
  },
  {
    category: 'account',
    subject: 'Changement d’adresse de courriel',
    body:
      'Mon adresse actuelle ne fonctionne plus, je voudrais la remplacer. Je peux ' +
      'prouver que le compte est bien le mien.',
    thread: [],
  },
  {
    category: 'other',
    subject: 'Proposition : un canal IRC pour les annonces',
    body:
      'Beaucoup de membres suivent les nouveautés via IRC ailleurs. Est-ce envisagé ' +
      'ici ? Je peux aider à la configuration.',
    thread: [['staff', 'Le module existe déjà côté administration. On ouvrira quand il sera réglé.']],
    close: { reason: 'rejected', note: 'Pas de refus sur le fond — sujet déjà couvert ailleurs.' },
  },
];

async function seedTickets() {
  // La file est derrière un réglage, comme la messagerie pour `demo.mjs`.
  const s = await req('founder', '/api/admin/settings', {
    method: 'PUT',
    body: { ticketsMode: 'on' },
  });
  line(s.status < 300, 'ticketsMode = on', s.status < 300 ? '' : `${s.status} ${JSON.stringify(s.body).slice(0, 140)}`);
  if (s.status >= 300) return;

  // Les deux états, pas seulement la file ouverte.
  //
  // `/api/mod/tickets` répond `status = 'open'` par défaut et ne bascule sur
  // les clos qu'avec `?closed=true`. Ne lire que le premier faisait recréer à
  // chaque relance les trois tickets que le script clôt lui-même — un garde
  // d'idempotence aveugle à la moitié de ce qu'il doit reconnaître.
  const known = new Set();
  for (const qs of ['', '?closed=true']) {
    const q = await req(STAFF[0], `/api/mod/tickets${qs}`);
    for (const x of q.body?.tickets ?? []) {
      if (x?.subject) known.add(x.subject);
    }
  }

  for (const t of TICKETS) {
    if (known.has(t.subject)) {
      line(true, 'ticket déjà là', t.subject.slice(0, 52));
      continue;
    }
    const author = nextMember();
    const r = await req(author, '/api/tickets', {
      method: 'POST',
      body: { subject: t.subject, category: t.category, body: t.body },
    });
    const id = r.body?.id ?? r.body?.data?.id ?? r.body?.ticket?.id;
    if (r.status >= 300 || !id) {
      line(false, `[${t.category}] ${t.subject.slice(0, 40)}`, `${r.status} ${JSON.stringify(r.body).slice(0, 140)}`);
      continue;
    }
    line(true, `${author} ouvre [${t.category}]`, t.subject.slice(0, 46));

    for (const [kind, body] of t.thread) {
      // Un membre ne voit et ne commente que SES tickets — la route répond 404
      // pour tout autre, ce qui est le bon comportement. Faire tourner les
      // membres comme sur le forum produisait donc deux fils amputés de leur
      // relance. Côté membre, c'est l'auteur qui parle ; côté staff, n'importe
      // qui du personnel.
      const speaker = kind === 'staff' ? nextStaff() : author;
      const m = await req(speaker, `/api/tickets/${id}/messages`, {
        method: 'POST',
        body: { body },
      });
      line(m.status < 300, `  ${speaker} répond`, m.status < 300 ? '' : String(m.status));
      await sleep(60);
    }

    if (t.assign) {
      const a = await req(STAFF[0], `/api/mod/tickets/${id}/assign`, {
        method: 'POST',
        body: { take: true },
      });
      line(a.status < 300, `  assigné à ${STAFF[0]}`, a.status < 300 ? '' : String(a.status));
    }
    if (t.close) {
      const c = await req(STAFF[0], `/api/mod/tickets/${id}/close`, {
        method: 'POST',
        body: t.close,
      });
      line(c.status < 300, `  clos (${t.close.reason})`, c.status < 300 ? '' : String(c.status));
    }
    await sleep(80);
  }
}

// ── Compte rendu ─────────────────────────────────────────────────────

async function summary() {
  const cats = await req('founder', '/api/forum/categories');
  const stats = await req('founder', '/api/forum/stats');
  const mine = await req(MEMBERS[0], '/api/tickets');
  const queue = await req(STAFF[0], '/api/mod/tickets');
  const count = (b) =>
    Array.isArray(b)
      ? b.length
      : (b?.tickets?.length ?? b?.items?.length ?? b?.data?.length ?? '?');
  console.log('');
  console.log(`  catégories de forum : ${count(cats.body)}`);
  console.log(`  statistiques forum  : ${JSON.stringify(stats.body).slice(0, 160)}`);
  console.log(`  tickets vus par un membre : ${count(mine.body)}`);
  console.log(`  file de modération        : ${count(queue.body)}`);
  console.log(`\n  à regarder : ${API.replace('54000', '53000')}/forum  et  /mod/tickets`);
}

await phase('forum', seedForum);
await phase('tickets', seedTickets);
await phase('compte rendu', summary);
