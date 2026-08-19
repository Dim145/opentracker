#!/usr/bin/env node
/**
 * Generates `apps/api/openapi.json` from the route tree.
 *
 * The hand-written documentation described 244 handlers in 458 lines. That kind
 * of file does not drift: it has already drifted by the time you read it. Here
 * the source of truth is the one Nitro itself uses — the filenames. A path
 * therefore cannot be documented without existing, nor exist without being
 * documented.
 *
 * What is derived automatically, and is therefore always right:
 *   - the path and method, from `routes/**\/<name>.<method>.ts`;
 *   - the path parameters, from the `[id]` segments;
 *   - whether authentication is required, from the guard call present in the
 *     file (`requireAdminSession`, `requireUserSession`, …);
 *   - the summary, from the first sentence of the header comment.
 *
 * What is not: the shape of request bodies and responses. The Zod schemas live
 * inside the handlers' closures, out of reach of any honest static analysis.
 * The 21 shared schemas in `utils/schemas.ts` are converted and exposed under
 * `components.schemas` — Zod 4 does that natively with `z.toJSONSchema()`, with
 * no extra dependency. A route can attach to one by naming its schema in its
 * header comment: `@body loginSchema`, `@query torrentQuerySchema`.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ROUTES = join(ROOT, 'routes');
const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'];

/** Authentication guards, strongest to weakest. */
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

/** The first sentence of the header comment, with the asterisks stripped. */
function summaryOf(src) {
  const block = src.match(/^\/\*\*([\s\S]*?)\*\//);
  if (!block) return null;
  const lines = block[1]
    .split('\n')
    .map((l) => l.replace(/^\s*\*ature?\s?/, '').replace(/^\s*\*\s?/, '').trim())
    .filter(Boolean);
  // The first line usually repeats "GET /api/...": skip it.
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

  // The shared schemas, converted by Zod itself.
  let components = {};
  try {
    const { z } = await import('zod');
    const schemas = await import(join(ROOT, 'utils/schemas.ts'));
    for (const [name, value] of Object.entries(schemas)) {
      if (!name.endsWith('Schema') || !value || typeof value !== 'object') continue;
      try {
        components[name] = z.toJSONSchema(value, { io: 'input', unrepresentable: 'any' });
      } catch {
        // A schema that cannot be represented (transform, complex refine) is
        // omitted rather than rendered wrongly.
      }
    }
  } catch (e) {
    console.warn(`  shared schemas not loaded (${e.message}) — spec without components`);
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

    // Attaching a shared schema. The route already names it in its validation
    // call — `validateBody(event, loginSchema)` — so we read that rather than
    // impose an annotation to write and keep up to date. The `@body` comment is
    // still honoured for the cases the call does not state.
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
        'Generated from the route tree. Paths, methods, path parameters and ' +
        'authentication requirements are derived from the code and therefore ' +
        'cannot drift. Request bodies are documented only for routes attached ' +
        'to a shared schema through `@body` / `@query`.',
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
    `openapi.json: ${routes.length} operations over ${Object.keys(paths).length} paths, ` +
      `${Object.keys(components).length} shared schemas, ${withBody} bodies attached`
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
