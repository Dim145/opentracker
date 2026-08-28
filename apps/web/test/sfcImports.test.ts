import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Identifiers a single-file component uses without importing them.
//
// This exists because nothing else catches them. `pnpm -w typecheck` compiles
// the API only — `tsc -p apps/api/.nitro/types/tsconfig.json` — and the CI notes
// in `.github/workflows/api-ci.yml` that there is deliberately no `vue-tsc` job
// for `apps/web`, because vue-tsc 3.x cannot run on the TypeScript this repo is
// on and a job that always passes is worse than no job. The build does not catch
// it either: an unimported identifier is valid JavaScript, a free global, and it
// throws only when the line runs.
//
// It cost a whole feature. `validateTokens` was called in `Themes.vue`'s theme
// importer and never imported there — it had been imported in the file the
// importer was SPLIT OUT OF — so every theme import, valid or not, threw a
// ReferenceError into the surrounding `catch` and reported "that file is not a
// theme export". The feature was dead in a way that looked like a rejection.
//
// The check is textual, like `printStylesheet.test.ts`, because that is what
// works without a Vue compiler in the test environment. It is narrow on purpose:
// it only knows about the shared packages, where this class of mistake actually
// happened, rather than trying to be a linter.

const WEB = fileURLToPath(new URL('../app', import.meta.url));

/** Every name the shared theme and css modules export. */
const SHARED_EXPORTS = ['theme', 'css', 'index'].flatMap((mod) => {
  const file = fileURLToPath(
    new URL(`../../../packages/shared/src/${mod}.ts`, import.meta.url),
  );
  return [...readFileSync(file, 'utf8').matchAll(
    /^export (?:async )?(?:function|const|class) (\w+)/gm,
  )].map((m) => m[1]!);
});

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? walk(join(dir, e.name))
      : e.name.endsWith('.vue')
        ? [join(dir, e.name)]
        : [],
  );
}

describe('single-file components import what they use', () => {
  const files = walk(WEB);

  it('finds components to check, so the sweep cannot pass by being empty', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it.each(files.map((f) => [f.slice(WEB.length + 1), f]))('%s', (_name, file) => {
    const src = readFileSync(file, 'utf8');
    const script = src.slice(src.indexOf('<script'), src.lastIndexOf('</script>'));
    if (!script) return;

    // What it imports, from anywhere — a name imported from another module is
    // not missing, whatever the shared package also happens to call it.
    const imported = new Set(
      [...script.matchAll(/import\s+(?:type\s+)?\{([^}]*)\}\s+from/g)]
        .flatMap((m) => m[1]!.split(','))
        .map((s) => s.replace(/^\s*type\s+/, '').split(/\s+as\s+/)[0]!.trim())
        .filter(Boolean),
    );

    // Comments stripped: these files explain themselves at length, and a name
    // in prose is not a call.
    const code = script
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');

    const missing = SHARED_EXPORTS.filter(
      (name) =>
        !imported.has(name) &&
        new RegExp(`(?<![.\\w$])${name}\\s*\\(`).test(code),
    );
    expect(missing, `called but not imported in ${file}`).toEqual([]);
  });
});
