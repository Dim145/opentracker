/**
 * Whether the boot-time migration step is judged to have worked.
 *
 * The case that matters most is the one the exit code gets wrong: drizzle-kit
 * printing a fatal error and exiting 0. The first assertion below is the
 * regression test for a container that booted on an unmigrated schema while
 * its log said "Schema up to date".
 */
import { describe, it, expect } from 'vitest';
import {
  classifyMigrationOutcome,
  formatMigrationFailure,
} from '../scripts/migrationOutcome.mjs';

interface PushFailure {
  ok: false;
  reason: string;
  detail: string;
  remedy: string[];
}

/**
 * Narrows the union and asserts the failure in one step. Without it every
 * assertion below needs an `if (out.ok) throw`, which buries the actual
 * expectation under ceremony.
 */
function expectFailure(out: { ok: boolean }): PushFailure {
  expect(out.ok).toBe(false);
  if (out.ok) throw new Error('expected a failed push');
  return out as PushFailure;
}

/** The real thing, trimmed, from drizzle-kit 0.31.10. */
const TTY_FAILURE = `[✓] Pulling schema from database...
Error: Interactive prompts require a TTY terminal (process.stdin.isTTY or process.stdout.isTTY is false). This can happen when running in CI, piped input, or non-interactive shells.
    at render10 (/app/db-tools/node_modules/.pnpm/drizzle-kit@0.31.10/node_modules/drizzle-kit/bin.cjs:1450:31)
    at tablesResolver (/app/db-tools/node_modules/.pnpm/drizzle-kit@0.31.10/node_modules/drizzle-kit/bin.cjs:32001:60)`;

describe('classifyMigrationOutcome', () => {
  it('fails a push that printed the TTY prompt error but exited 0', () => {
    // The whole point: exit code 0 must not be enough to call this a success.
    const out = expectFailure(classifyMigrationOutcome({ code: 0, output: TTY_FAILURE }));
    expect(out.reason).toMatch(/interactive/i);
  });

  it('explains that no flag can answer the rename question', () => {
    // If this text ever drifts into promising a magic env var, the operator
    // will go looking for one instead of reconciling the schema.
    const out = expectFailure(classifyMigrationOutcome({ code: 0, output: TTY_FAILURE }));
    expect(out.detail).toMatch(/rename/i);
    expect(out.detail).toMatch(/--force/);
    expect(out.remedy.join(' ')).toMatch(/SKIP_DB_MIGRATIONS/);
  });

  it('passes a clean push', () => {
    const out = classifyMigrationOutcome({
      code: 0,
      output: '[✓] Pulling schema from database...\nNo changes detected\n',
    });
    expect(out.ok).toBe(true);
  });

  it('fails on a non-zero exit even with no recognisable message', () => {
    const out = expectFailure(
      classifyMigrationOutcome({ code: 1, output: 'something went sideways' })
    );
    expect(out.reason).toMatch(/exited with 1/);
  });

  it('points a hard failure at the pooler trap', () => {
    // The recurring one before MIGRATIONS_DATABASE_URL existed: pgbouncer in
    // transaction mode drops the session state the introspection needs.
    const out = expectFailure(
      classifyMigrationOutcome({ code: 1, output: 'prepared statement does not exist' })
    );
    expect(out.detail).toMatch(/MIGRATIONS_DATABASE_URL/);
  });

  it('fails on any reported error, not just the one signature we know', () => {
    // Exit codes cannot be trusted from this tool, so an `Error:` line is
    // taken at its word rather than matched against a list.
    const out = expectFailure(
      classifyMigrationOutcome({
        code: 0,
        output: 'Error: relation "users" does not exist',
      })
    );
    expect(out.detail).toContain('relation "users" does not exist');
  });

  it('does not mistake the word error inside ordinary output for a failure', () => {
    // `Error:` is anchored to the start of a line; prose must not trip it.
    const out = classifyMigrationOutcome({
      code: 0,
      output: 'Applying changes... no error handling needed here\nDone\n',
    });
    expect(out.ok).toBe(true);
  });

  it('takes a null exit code as a failure', () => {
    // A process killed by a signal reports code null — the schema is in an
    // unknown state, which is not a success.
    expectFailure(classifyMigrationOutcome({ code: null, output: '' }));
  });
});

describe('formatMigrationFailure', () => {
  it('states plainly that nothing was applied, and every remedy', () => {
    const out = expectFailure(classifyMigrationOutcome({ code: 0, output: TTY_FAILURE }));
    const text = formatMigrationFailure(out);
    expect(text).toMatch(/schema was not applied/i);
    for (const step of out.remedy) {
      expect(text).toContain(step);
    }
  });
});
