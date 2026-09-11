import { describe, it, expect } from 'vitest';
import { validateChannelConfig, MAX_VALUE_LEN } from '../utils/channels/validateConfig';
import type { ChannelField } from '../utils/channels/types';

// Both channel write routes hand a user-supplied blob to an adapter that has
// already declared, field by field, what it expects. Until this validator
// existed nothing compared the two: the SMTP `to` field was declared
// `type: 'email'` and accepted any 4 KB string, and the admin route accepted
// anything at all. These tests pin the declared type as the contract.

const f = (over: Partial<ChannelField> & Pick<ChannelField, 'key' | 'type'>): ChannelField => ({
  labelKey: `label.${over.key}`,
  required: false,
  ...over,
});

const FIELDS: ChannelField[] = [
  f({ key: 'to', type: 'email' }),
  f({ key: 'endpoint', type: 'url' }),
  f({ key: 'port', type: 'int' }),
  f({ key: 'secure', type: 'bool' }),
  f({ key: 'note', type: 'string' }),
  f({ key: 'pass', type: 'password', secret: true }),
  f({
    key: 'mode',
    type: 'select',
    options: [
      { value: 'fast', label: 'Fast' },
      { value: 'slow', label: 'Slow' },
    ],
  }),
];

/** Le validateur lève ; on récupère le code pour l'affirmer. */
function statusOf(config: Record<string, unknown>): number | 'ok' {
  try {
    validateChannelConfig(FIELDS, config);
    return 'ok';
  } catch (err) {
    return (err as { statusCode?: number }).statusCode ?? -1;
  }
}

describe('email fields', () => {
  it('takes the addresses a member actually has', () => {
    for (const to of [
      'member@example.com',
      'first.last+tracker@sub.example.co.uk',
      'prénom@exemple.fr', // le public est francophone : l'Unicode passe
      'x@e.io',
    ]) {
      expect(statusOf({ to }), to).toBe('ok');
    }
  });

  it('refuses the shapes two parsers would read differently', () => {
    // GHSA-cc9r-2j5m-2m83 : un commentaire RFC 5322 dans le domaine était
    // concaténé au lieu de le terminer, donc `comevil.com` recevait le
    // message. On refuse la parenthèse plutôt que d'arbitrer la grammaire.
    expect(statusOf({ to: 'user@good-corp.com(x)evil.com' })).toBe(400);
    expect(statusOf({ to: 'Nom <user@example.com>' })).toBe(400);
    expect(statusOf({ to: 'user@example.com, other@evil.com' })).toBe(400);
    expect(statusOf({ to: 'user@example.com;other@evil.com' })).toBe(400);
    expect(statusOf({ to: '"quoted"@example.com' })).toBe(400);
    expect(statusOf({ to: 'user@exam\tple.com' })).toBe(400);
  });

  it('refuses what is simply not an address', () => {
    for (const to of [
      'not-an-address',
      '@example.com',
      'user@',
      'user@@example.com',
      'user@nodot',
      'user@example..com',
      '.user@example.com',
      'user.@example.com',
      'u..ser@example.com',
      'user@-example.com',
    ]) {
      expect(statusOf({ to }), to).toBe(400);
    }
  });

  it('closes the door the quadratic parser came through', () => {
    // La route plafonnait déjà la valeur à 4096 caractères, ce qui limitait
    // le coût — mais rien n'empêchait d'y ranger 300 destinataires. Une
    // adresse, désormais, est une adresse.
    const many = Array.from({ length: 300 }, (_, i) => `u${i}@x.tld`).join(',');
    expect(many.length).toBeLessThan(MAX_VALUE_LEN);
    expect(statusOf({ to: many })).toBe(400);
  });
});

describe('url fields', () => {
  it('takes what a self-hosted instance legitimately points at', () => {
    // L'hôte reste libre : gotify ou ntfy tournent souvent sur un nom
    // interne. C'est safeFetch qui décide de la joignabilité, pas ici.
    for (const endpoint of [
      'https://hooks.example.com/services/T/B/x',
      'http://gotify:80/message',
      'http://192.168.1.10:8080/',
      'https://ntfy.example.com/topic?priority=5',
    ]) {
      expect(statusOf({ endpoint }), endpoint).toBe('ok');
    }
  });

  it('refuses a non-http scheme or a non-URL', () => {
    for (const endpoint of [
      'ftp://files.example.com/x',
      'javascript:alert(1)',
      'file:///etc/passwd',
      'hooks.example.com/x', // sans schéma, `new URL` échoue
      'not a url',
    ]) {
      expect(statusOf({ endpoint }), endpoint).toBe(400);
    }
  });
});

describe('int fields', () => {
  it('takes an integer in either wire form, sign and zero included', () => {
    // Le formulaire envoie Number(...), mais une priorité gotify/ntfy est
    // légitimement nulle ou négative : pas de borne ici.
    for (const port of [587, 0, -2, '587', '-2']) {
      expect(statusOf({ port }), String(port)).toBe('ok');
    }
  });

  it('refuses a decimal, a word, a padded digit or a boolean', () => {
    for (const port of [1.5, 'abc', '5.0', ' 5', true]) {
      expect(statusOf({ port }), String(port)).toBe(400);
    }
  });
});

describe('bool and select fields', () => {
  it('wants a real boolean, not its spelling', () => {
    expect(statusOf({ secure: true })).toBe('ok');
    expect(statusOf({ secure: false })).toBe('ok');
    expect(statusOf({ secure: 'true' })).toBe(400);
    expect(statusOf({ secure: 1 })).toBe(400);
  });

  it('holds a select to its declared options', () => {
    expect(statusOf({ mode: 'fast' })).toBe('ok');
    expect(statusOf({ mode: 'turbo' })).toBe(400);
  });
});

describe('shape rules, which the admin route did not have at all', () => {
  it('refuses an undeclared key', () => {
    expect(statusOf({ nope: 'x' })).toBe(400);
  });

  it('refuses more entries than the adapter declares', () => {
    const tooMany = Object.fromEntries(
      Array.from({ length: FIELDS.length + 1 }, (_, i) => [`k${i}`, 'v'])
    );
    expect(statusOf(tooMany)).toBe(400);
  });

  it('caps a value at 4096 characters', () => {
    expect(statusOf({ note: 'a'.repeat(MAX_VALUE_LEN) })).toBe('ok');
    expect(statusOf({ note: 'a'.repeat(MAX_VALUE_LEN + 1) })).toBe(413);
  });

  it('refuses a non-primitive', () => {
    expect(statusOf({ note: { nested: true } })).toBe(400);
    expect(statusOf({ note: ['a'] })).toBe(400);
  });

  it('lets an optional field be cleared without type-checking the blank', () => {
    // Vider un champ facultatif est le seul moyen d'annuler une valeur ;
    // exiger qu'une chaîne vide soit une adresse valide rendrait l'opération
    // impossible.
    expect(statusOf({ to: '', endpoint: '', port: '' })).toBe('ok');
    expect(statusOf({ to: null, secure: null })).toBe('ok');
  });

  it('accepts an empty blob', () => {
    expect(statusOf({})).toBe('ok');
  });
});

describe('the real adapters', () => {
  // Le validateur ne vaut que s'il laisse passer ce que les canaux existants
  // écrivent réellement. On rejoue donc une configuration plausible pour
  // chacun, contre ses vraies déclarations de champs — c'est ce test qui
  // criera si quelqu'un requalifie un champ en `url` ou en `email` sans
  // regarder ce que le formulaire y met.
  // Les blocs ci-dessous suivent ce que chaque adaptateur déclare vraiment :
  // discord, slack et mattermost n'ont AUCUN champ serveur (chaque membre
  // pose son propre webhook), web_push n'a aucun champ membre, et sa clé de
  // registre porte un souligné que son fichier n'a pas.
  const PLAUSIBLE: Record<string, { server?: Record<string, unknown>; user?: Record<string, unknown> }> = {
    apprise: {
      server: { apiUrl: 'http://apprise:8000/notify' },
      // une URL Apprise n'est pas du http : `discord://`, `tgram://`… d'où
      // le type `string`, que le validateur laisse tranquille
      user: { appriseUrl: 'tgram://bottoken/ChatID' },
    },
    discord: {
      user: { webhookUrl: 'https://discord.com/api/webhooks/2/def', username: 'Trackarr' },
    },
    gotify: {
      server: { baseUrl: 'http://gotify' },
      user: { appToken: 'AzX9', priority: 5 },
    },
    mattermost: {
      user: { webhookUrl: 'https://mm.example.com/hooks/xyz' },
    },
    ntfy: {
      server: { baseUrl: 'https://ntfy.sh', authHeader: 'Bearer tk_x' },
      user: { topic: 'trackarr-alerts', priority: 3 },
    },
    pushover: {
      server: { apiToken: 'a'.repeat(30) },
      user: { userKey: 'u'.repeat(30), priority: 0 },
    },
    slack: {
      user: { webhookUrl: 'https://hooks.slack.com/services/T/B/y' },
    },
    telegram: {
      server: { botToken: '123:AAF' },
      user: { chatId: '-1001234567890' },
    },
    webhook: {
      server: { hmacSecret: 's'.repeat(32) },
      user: { url: 'https://example.com/hook', headers: '{"X-Token":"abc"}' },
    },
    web_push: {
      // `subject` est un mailto:, pas une adresse nue : le type déclaré est
      // bien `string`
      server: { subject: 'mailto:admin@example.com', publicKey: 'BP', privateKey: 'pk' },
    },
    smtp: {
      // `from` reste `string` et non `email` : la forme « Nom <adresse> » y
      // est légitime, et c'est le plafond de longueur qui la borne
      server: {
        host: 'smtp.example.com',
        port: 587,
        secure: false,
        user: 'postmaster@example.com',
        pass: 'hunter2',
        from: 'Trackarr <noreply@example.com>',
      },
      user: { to: 'member@example.com' },
    },
  };

  it.each(Object.keys(PLAUSIBLE))('accepts a plausible %s config', async (type) => {
    const { getAdapter } = await import('../utils/channels');
    const adapter = getAdapter(type);
    expect(adapter, `adapter ${type} exists`).toBeTruthy();
    const sample = PLAUSIBLE[type]!;
    if (sample.server) {
      expect(() => validateChannelConfig(adapter!.serverFields, sample.server!)).not.toThrow();
    }
    if (sample.user) {
      expect(() => validateChannelConfig(adapter!.userFields, sample.user!)).not.toThrow();
    }
  });

  it('covers every registered adapter', async () => {
    // Un canal ajouté sans échantillon ici passerait sous le radar : on
    // compare la liste au registre plutôt que de faire confiance à la
    // vigilance du prochain.
    const { ALL_CHANNEL_TYPES } = await import('../utils/channels');
    expect(Object.keys(PLAUSIBLE).sort()).toEqual([...ALL_CHANNEL_TYPES].sort());
  });
});
