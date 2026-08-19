#!/usr/bin/env node
/**
 * Génère `apps/api/openapi.json` depuis l'arborescence des routes.
 *
 * La documentation manuscrite décrivait 244 handlers en 458 lignes. Ce genre de
 * fichier ne dérive pas : il a déjà dérivé au moment où on le relit. Ici, la
 * source de vérité est celle que Nitro utilise lui-même — le nom des fichiers.
 * Un chemin ne peut donc pas être documenté s'il n'existe pas, ni exister sans
 * être documenté.
 *
 * Ce qui est dérivé automatiquement, et donc toujours juste :
 *   - le chemin et la méthode, depuis `routes/**\/<nom>.<methode>.ts` ;
 *   - les paramètres de chemin, depuis les segments `[id]` ;
 *   - le besoin d'authentification, depuis l'appel de garde présent dans le
 *     fichier (`requireAdminSession`, `requireUserSession`, …) ;
 *   - le résumé, depuis la première phrase du commentaire de tête.
 *
 * Ce qui ne l'est pas : la forme des corps de requête et des réponses. Les
 * schémas Zod vivent dans la fermeture des handlers, hors d'atteinte d'une
 * analyse statique honnête. Les 21 schémas partagés de `utils/schemas.ts` sont
 * en revanche convertis et exposés dans `components.schemas` — Zod 4 sait le
 * faire nativement avec `z.toJSONSchema()`, sans dépendance supplémentaire. Une
 * route peut s'y rattacher en nommant son schéma dans son commentaire de tête :
 * `@body loginSchema`, `@query torrentQuerySchema`.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ROUTES = join(ROOT, 'routes');
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'];

/** Gardes d'authentification, de la plus forte à la plus faible. */
const GUARDS = [
  ['requireAdminSession', 'admin'],
  ['requireModeratorSession', 'moderator'],
  ['requireFreshAuth', 'fresh-auth'],
  ['requireSessionOrApiKey', 'session-or-api-key'],
  ['requireUserSession', 'user'],
];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else if (entry.name.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** `api/torrents/[hash]/index.get.ts` → `{ path: '/api/torrents/{hash}', method: 'get' }` */
function toRoute(file) {
  const rel = relative(ROUTES, file).replace(/\\/g, '/');
  const m = rel.match(/^(.*)\.([a-z]+)\.ts$/);
  if (!m || !METHODS.includes(m[2])) return null;
  let path = m[1]
    .replace(/\/index$/, '')
    .replace(/^index$/, '')
    .replace(/\[\.\.\.(\w+)\]/g, '{$1}')
    .replace(/\[(\w+)\]/g, '{$1}');
  path = '/' + path.replace(/^\/+/, '');
  return { path, method: m[2], file };
}

/** Première phrase du commentaire de tête, débarrassée des astérisques. */
function summaryOf(src) {
  const block = src.match(/^\/\*\*([\s\S]*?)\*\//);
  if (!block) return null;
  const lines = block[1]
    .split('\n')
    .map((l) => l.replace(/^\s*\*ature?\s?/, '').replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean);
  // La première ligne répète en général « GET /api/... » : on la saute.
  const body = lines.filter((l) => !/^[A-Z]+\s+\//.test(l) && !l.startsWith('@'));
  if (!body.length) return null;
  const text = body.join(' ');
  const dot = text.indexOf('. ');
  return (dot > 0 ? text.slice(0, dot + 1) : text).slice(0, 300);
}

function tagOf(path) {
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'api') return parts[0] ?? 'root';
  return parts[1] ?? 'api';
}

async function main() {
  const files = await walk(ROUTES);
  const routes = files.map(toRoute).filter(Boolean);

  // Les schémas partagés, convertis par Zod lui-même.
  let components = {};
  try {
    const { z } = await import('zod');
    const schemas = await import(join(ROOT, 'utils/schemas.ts'));
    for (const [name, value] of Object.entries(schemas)) {
      if (!name.endsWith('Schema') || !value || typeof value !== 'object') continue;
      try {
        components[name] = z.toJSONSchema(value, { io: 'input', unrepresentable: 'any' });
      } catch {
        // Un schéma non représentable (transform, refine complexe) est omis
        // plutôt que rendu faux.
      }
    }
  } catch (e) {
    console.warn(`  schémas partagés non chargés (${e.message}) — spec sans components`);
  }

  const paths = {};
  for (const r of routes.sort((a, b) => a.path.localeCompare(b.path))) {
    const src = await readFile(r.file, 'utf8');
    const guard = GUARDS.find(([fn]) => src.includes(`${fn}(`));
    const params = [...r.path.matchAll(/\{(\w+)\}/g)].map((m) => ({
      name: m[1],
      in: 'path',
      required: true,
      schema: { type: 'string' },
    }));

    const op = {
      tags: [tagOf(r.path)],
      operationId: `${r.method}${r.path.replace(/[^\w]+/g, '_')}`,
      summary: summaryOf(src) ?? undefined,
      parameters: params.length ? params : undefined,
      security: guard ? [{ session: [] }] : [],
      responses: {
        200: { description: 'OK' },
        ...(guard ? { 401: { description: 'Not authenticated' } } : {}),
        ...(guard && guard[1] !== 'user'
          ? { 403: { description: `Requires ${guard[1]}` } }
          : {}),
      },
      'x-auth': guard ? guard[1] : 'public',
    };

    // Rattachement d'un schéma partagé. La route le nomme déjà dans son appel
    // de validation — `validateBody(event, loginSchema)` — donc on lit ça
    // plutôt que d'imposer une annotation à écrire et à tenir à jour. Le
    // commentaire `@body` reste accepté pour les cas que l'appel ne dit pas.
    const body =
      src.match(/@body\s+(\w+Schema)/) ||
      src.match(/validateBody\(\s*event\s*,\s*(\w+Schema)/);
    if (body && components[body[1]]) {
      op.requestBody = {
        required: true,
        content: {
          'application/json': {
            schema: { $ref: `#/components/schemas/${body[1]}` },
          },
        },
      };
    }
    const query =
      src.match(/@query\s+(\w+Schema)/) ||
      src.match(/validateQuery\(\s*event\s*,\s*(\w+Schema)/);
    if (query && components[query[1]]) {
      op.parameters = [
        ...(op.parameters ?? []),
        {
          name: 'query',
          in: 'query',
          schema: { $ref: `#/components/schemas/${query[1]}` },
          style: 'form',
          explode: true,
        },
      ];
    }

    paths[r.path] ??= {};
    paths[r.path][r.method] = op;
  }

  const pkg = JSON.parse(await readFile(join(ROOT, 'package.json'), 'utf8'));
  const spec = {
    openapi: '3.1.0',
    info: {
      title: 'Trackarr API',
      version: pkg.version,
      description:
        'Généré depuis l\'arborescence des routes. Chemins, méthodes, ' +
        'paramètres de chemin et exigences d\'authentification sont dérivés du ' +
        'code et ne peuvent donc pas dériver. Les corps de requête ne sont ' +
        'documentés que pour les routes rattachées à un schéma partagé via ' +
        '`@body` / `@query`.',
    },
    servers: [{ url: '/' }],
    components: {
      schemas: components,
      securitySchemes: {
        session: { type: 'apiKey', in: 'cookie', name: 'nuxt-session' },
      },
    },
    paths,
  };

  const out = join(ROOT, 'openapi.json');
  await writeFile(out, JSON.stringify(spec, null, 2) + '\n', 'utf8');
  const withBody = Object.values(paths)
    .flatMap((p) => Object.values(p))
    .filter((o) => o.requestBody).length;
  console.log(
    `openapi.json : ${routes.length} opérations sur ${Object.keys(paths).length} chemins, ` +
      `${Object.keys(components).length} schémas partagés, ${withBody} corps rattachés`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
