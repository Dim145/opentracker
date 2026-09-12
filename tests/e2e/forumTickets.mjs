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
    name: 'Announcements',
    description: 'What the staff posts and nobody gets to claim they missed.',
    color: '#c2410c',
    icon: 'ph:megaphone',
    order: 0,
  },
  {
    name: 'Help',
    description: 'A client that will not seed, a ratio that will not move.',
    color: '#0e7490',
    icon: 'ph:lifebuoy',
    order: 1,
  },
  {
    name: 'Discussion',
    description: 'Everything else — what we watch, what we hunt for, what we love.',
    color: '#4d7c0f',
    icon: 'ph:chats-circle',
    order: 2,
  },
];

/** Les sujets, par nom de catégorie. `by` tourne sur les comptes disponibles. */
const TOPICS = {
  Announcements: [
    {
      title: 'Rules: the three things that get you banned',
      content:
        'Your ratio is not one of them. What gets you banned: faking announces, ' +
        'sharing your passkey, and selling an invite. Everything else is negotiable.',
      by: 'staff',
      pin: true,
      replies: [
        ['member', 'Thanks for being clear. What about sharing a passkey within a household?'],
        ['staff', 'Same household, same IP: fine. Two different cities: no.'],
      ],
    },
    {
      title: 'Database maintenance — Saturday 06:00 UTC',
      content:
        'One hour of downtime planned. Announces will keep being accepted; only ' +
        'the site itself goes down.',
      by: 'staff',
      lock: true,
      replies: [],
    },
  ],
  Help: [
    {
      title: 'My client announces but the tracker shows me offline',
      content:
        'Transmission 4.0, port 6881 open, and still I do not show up in the ' +
        'swarm. I have checked the passkey twice.',
      by: 'member',
      replies: [
        ['member', 'Check you do not have two clients on the same torrent with two peer_ids.'],
        ['staff', 'Your passkey was rotated two days ago — grab the .torrent again.'],
        ['member', 'That was it. Thanks, updating the file everywhere.'],
      ],
    },
    {
      title: 'How do I read the S / L / C columns in the catalogue?',
      content:
        'Seeders, leechers, and the third one? I am guessing "completed" but I would rather ask.',
      by: 'member',
      replies: [['staff', 'That is it: the number of downloads finished since the torrent went up.']],
    },
  ],
  Discussion: [
    {
      title: 'What you found here that you would have missed anywhere else',
      content:
        'A private tracker is also a library. Tell us about the find you were not ' +
        'looking for.',
      by: 'member',
      replies: [
        ['member', 'A 1974 documentary about dam building, in 4K, restored by a member here.'],
        ['member', 'The complete discography of a Swiss label I knew nothing about.'],
        ['staff', 'This thread deserves a pin one day. We are thinking about it.'],
      ],
    },
    {
      title: 'Your seedbox settings, without the marketing numbers',
      content:
        'How many torrents in parallel before things degrade? Four hundred, for me.',
      by: 'member',
      replies: [['member', 'Two hundred, but my disk is spinning rust.']],
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
    subject: 'Appeal: banned for hit-and-run',
    body:
      'I was banned for three hit-and-runs. Two of them were a four-day fibre outage ' +
      'at my place, which I can document. Happy to send the provider statement.',
    thread: [
      ['staff', 'Send the statement and we will look. The account stays suspended meanwhile.'],
      ['member', 'Outage dates were the 4th to the 8th. The third one I will own.'],
    ],
    close: { reason: 'resolved', note: 'Two H&Rs voided, the third stands. Account reopened.' },
  },
  {
    category: 'upload',
    subject: 'My upload was refused with no visible reason',
    body:
      'I posted a 1080p remux yesterday, the entry vanished from my uploads and I ' +
      'cannot find any message about it. Is it a duplicate?',
    thread: [
      ['staff', 'It is a duplicate: the same source has been up since March, at better quality.'],
    ],
    assign: true,
  },
  {
    category: 'bug',
    subject: 'Saved searches do not replay',
    body:
      'I click the magnifier on a saved search and land on the whole catalogue with ' +
      'no filter applied at all. Tried in two browsers.',
    thread: [
      ['staff', 'Reproduced. The generated link carried the wrong parameter names — fixed.'],
      ['member', 'Confirmed on my side, thank you.'],
    ],
    close: { reason: 'resolved', note: 'Parameter names corrected on the client side.' },
  },
  {
    category: 'account',
    subject: 'Email address change',
    body:
      'My current address no longer works and I would like to replace it. I can ' +
      'prove the account is mine.',
    thread: [],
  },
  {
    category: 'other',
    subject: 'Suggestion: an IRC channel for announces',
    body:
      'A lot of members follow new releases over IRC elsewhere. Is that on the cards ' +
      'here? I am happy to help set it up.',
    thread: [['staff', 'The module already exists on the admin side. We will open it once it is tuned.']],
    close: { reason: 'rejected', note: 'Not a no on the merits — already covered elsewhere.' },
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
