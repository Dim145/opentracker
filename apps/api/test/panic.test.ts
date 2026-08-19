import { describe, it, expect } from 'vitest';
import { randomBytes, createCipheriv } from 'node:crypto';
import {
  deriveKey,
  encrypt,
  decrypt,
  generateSalt,
  encryptField,
  decryptField,
} from '../utils/panic';

// Chiffrement du mode panique. Ce module est le seul usage d'AES-GCM du
// projet, et il sert deux chemins : la mise sous scellés de la base, et les
// secrets des canaux de notification (`channelSecrets.ts`), qui eux tournent
// en permanence. Une régression ici ne casse pas un écran, elle rend des
// données illisibles — sans message d'erreur exploitable, puisque GCM échoue
// de la même façon qu'une clé fausse.
//
// L'enjeu principal des cas ci-dessous est la longueur du tag
// d'authentification. Sans `authTagLength`, Node accepte pour GCM des tags de
// 4, 8, 12, 13, 14, 15 ou 16 octets ; le tag venant de la chaîne stockée en
// base, un attaquant capable d'y écrire pourrait le tronquer et ramener le
// coût d'une forge de 2^128 à 2^32. Avec GCM, une forge réussie sur tag court
// fait fuiter la sous-clé d'authentification H et ouvre des forges
// arbitraires — exactement le scénario que le mode panique existe pour
// couvrir. D'où les deux tests « tag tronqué ».

const PASSWORD = 'un-mot-de-passe-de-panique-correct';

async function key(): Promise<Buffer> {
  return deriveKey(PASSWORD, Buffer.from(generateSalt(), 'base64'));
}

describe('deriveKey / generateSalt', () => {
  it('dérive une clé AES-256 de 32 octets', async () => {
    const k = await key();
    expect(k).toBeInstanceOf(Buffer);
    expect(k.length).toBe(32);
  });

  it('est déterministe à sel constant, et diverge sinon', async () => {
    const salt = Buffer.from(generateSalt(), 'base64');
    const a = await deriveKey(PASSWORD, salt);
    const b = await deriveKey(PASSWORD, salt);
    const c = await deriveKey(PASSWORD, Buffer.from(generateSalt(), 'base64'));
    expect(a.equals(b)).toBe(true);
    expect(a.equals(c)).toBe(false);
  });

  it('produit un sel de 32 octets, différent à chaque appel', () => {
    const s1 = Buffer.from(generateSalt(), 'base64');
    const s2 = Buffer.from(generateSalt(), 'base64');
    expect(s1.length).toBe(32);
    expect(s1.equals(s2)).toBe(false);
  });
});

describe('encrypt / decrypt', () => {
  it('fait un aller-retour fidèle, y compris sur de l’UTF-8 non ASCII', async () => {
    const k = await key();
    for (const clear of [
      'a',
      '',
      'https://hooks.example.org/T00/B01/xoxb-secret',
      'accentué — ﬁchier « clé » 日本語 🎬',
      'x'.repeat(10_000),
    ]) {
      expect(decrypt(encrypt(clear, k), k)).toBe(clear);
    }
  });

  it('émet `iv:ct:tag` avec un IV de 12 octets et un tag de 16', async () => {
    const k = await key();
    const parts = encrypt('charge utile', k).split(':');
    expect(parts).toHaveLength(3);
    expect(Buffer.from(parts[0]!, 'base64').length).toBe(12);
    // 16 octets : le défaut de Node pour GCM, et ce que `authTagLength`
    // impose désormais au déchiffrement. Si ce test tombe, toute donnée
    // déjà stockée devient illisible — c'est le garde-fou du correctif.
    expect(Buffer.from(parts[2]!, 'base64').length).toBe(16);
  });

  it('utilise un IV neuf à chaque appel, donc deux chiffrés du même clair diffèrent', async () => {
    const k = await key();
    expect(encrypt('même texte', k)).not.toBe(encrypt('même texte', k));
  });

  it('refuse une clé différente', async () => {
    const blob = encrypt('secret', await key());
    const autre = await key();
    expect(() => decrypt(blob, autre)).toThrow();
  });

  it('refuse un texte chiffré altéré', async () => {
    const k = await key();
    const [iv, ct, tag] = encrypt('secret', k).split(':');
    const bytes = Buffer.from(ct!, 'base64');
    bytes[0] ^= 0xff;
    expect(() => decrypt(`${iv}:${bytes.toString('base64')}:${tag}`, k)).toThrow();
  });

  it('refuse un tag altéré mais de bonne longueur', async () => {
    const k = await key();
    const [iv, ct, tag] = encrypt('secret', k).split(':');
    const bytes = Buffer.from(tag!, 'base64');
    bytes[0] ^= 0x01;
    expect(() => decrypt(`${iv}:${ct}:${bytes.toString('base64')}`, k)).toThrow();
  });

  it('refuse un tag TRONQUÉ au lieu de l’accepter', async () => {
    const k = await key();
    const [iv, ct, tag] = encrypt('secret', k).split(':');
    // Sans `authTagLength`, Node acceptait ces longueurs et se contentait de
    // vérifier les premiers octets — la brèche que le correctif ferme.
    for (const n of [4, 8, 12, 15]) {
      const court = Buffer.from(tag!, 'base64').subarray(0, n).toString('base64');
      expect(() => decrypt(`${iv}:${ct}:${court}`, k)).toThrow();
    }
  });

  it('refuse un format mal formé', async () => {
    const k = await key();
    for (const bad of ['', 'pasdeseparateur', 'a:b:c:d']) {
      expect(() => decrypt(bad, k)).toThrow();
    }
  });
});

describe('format hérité `ct:tag`', () => {
  // Les toutes premières versions stockaient un IV global de 16 octets à
  // part. La restauration doit continuer à lire ces lignes, sinon une base
  // mise sous scellés avant la migration devient définitivement illisible.
  function encryptLegacy(text: string, k: Buffer, iv: Buffer): string {
    const cipher = createCipheriv('aes-256-gcm', k, iv);
    let out = cipher.update(text, 'utf8', 'base64');
    out += cipher.final('base64');
    return `${out}:${cipher.getAuthTag().toString('base64')}`;
  }

  it('déchiffre un couple en deux parties quand l’IV hérité est fourni', async () => {
    const k = await key();
    const legacyIv = randomBytes(16);
    const blob = encryptLegacy('ancienne donnée', k, legacyIv);
    expect(decrypt(blob, k, legacyIv)).toBe('ancienne donnée');
  });

  it('refuse deux parties sans IV hérité plutôt que de deviner', async () => {
    const k = await key();
    const blob = encryptLegacy('ancienne donnée', k, randomBytes(16));
    expect(() => decrypt(blob, k)).toThrow(/Malformed/);
  });
});

describe('encryptField / decryptField', () => {
  it('laisse passer null et undefined sans les chiffrer', async () => {
    const k = await key();
    expect(encryptField(null, k)).toBeNull();
    expect(encryptField(undefined, k)).toBeNull();
    expect(decryptField(null, k)).toBeNull();
  });

  it('fait l’aller-retour sur une valeur présente, chaîne vide comprise', async () => {
    const k = await key();
    for (const v of ['', 'valeur', '0']) {
      expect(decryptField(encryptField(v, k), k)).toBe(v);
    }
  });
});
