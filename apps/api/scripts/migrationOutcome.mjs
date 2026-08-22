/**
 * Did the boot-time schema step actually work?
 *
 * This exists because the obvious answer — look at the exit code — is wrong.
 * The drizzle tooling can print a fatal error, apply nothing, and still exit 0.
 * Observed on drizzle-kit 0.31.10:
 *
 *   [✓] Pulling schema from database...
 *   Error: Interactive prompts require a TTY terminal (process.stdin.isTTY or
 *   process.stdout.isTTY is false). This can happen when running in CI, piped
 *   input, or non-interactive shells.
 *       at tablesResolver (.../drizzle-kit/bin.cjs:32001:60)
 *   → exit code 0
 *
 * The entrypoint dutifully checked the exit code, saw 0, logged "Schema up to
 * date" and booted the API against a database missing the columns the release
 * needed. Every query touching them then failed at runtime, with the boot log
 * claiming success. That is the failure this module is here to stop: a boot
 * step that lies is worse than one that dies.
 *
 * So the outcome is read from the output as well as the status, and anything
 * that looks like a failure is treated as one. Erring towards a container that
 * refuses to start is the right direction — a stopped container is a page, a
 * silently stale schema is a mystery.
 *
 * Kept as a separate pure module so the classification is unit-testable: the
 * entrypoint itself spawns processes and imports a server bundle, neither of
 * which belongs in a test.
 */

/**
 * `drizzle-kit push` needs a human when the diff is ambiguous. The boot no
 * longer uses push — it applies committed migrations — but the check stays: a
 * `pnpm db:push` in dev hits it, and so would anyone reverting the boot step.
 * The one that bites is the table resolver: when one table exists only in
 * the database and another only in schema.ts, it asks whether that is a rename
 * or a create-plus-drop.
 *
 * There is deliberately no env var to answer this automatically, because the
 * two answers are not variations of the same thing — "renamed" carries the
 * rows over, "created + dropped" destroys them. Only the person who made the
 * change knows which they meant. `--force` (already passed) covers the
 * confirmation-style prompts, where "yes" is at least a meaningful default;
 * this is not one of those.
 */
const INTERACTIVE_PROMPT = /Interactive prompts require a TTY/i;

/** drizzle-kit prints its fatal errors on their own line, whatever the code. */
const ERROR_LINE = /^Error:.*$/m;

/**
 * @param {{ code: number | null, output: string }} result
 * @returns {{ ok: true } | { ok: false, reason: string, detail: string, remedy: string[] }}
 */
export function classifyPushOutcome({ code, output }) {
  const text = output ?? '';

  if (INTERACTIVE_PROMPT.test(text)) {
    return {
      ok: false,
      reason: 'drizzle-kit needed an interactive answer and there is no terminal here',
      detail:
        'This is the table resolver: one table exists only in the database and ' +
        'another only in schema.ts, so drizzle-kit cannot tell a rename from a ' +
        'create-plus-drop. It asked, found no TTY, applied nothing — and still ' +
        'exited 0, which is why this is caught by reading the output rather ' +
        'than the status code. No flag answers this safely: "renamed" keeps the ' +
        'rows, "created + dropped" destroys them, and --force (already passed) ' +
        'only covers data-loss confirmations.',
      remedy: [
        'Compare the table names in packages/db/src/schema.ts against the live ' +
          'database and reconcile the pair that diverges.',
        'Or apply the SQL under packages/db/src/migrations/ by hand, then boot ' +
          'with SKIP_DB_MIGRATIONS=true so the step is not attempted.',
      ],
    };
  }

  if (code !== 0) {
    return {
      ok: false,
      reason: `the migration step exited with ${code}`,
      detail:
        'The step reported a hard failure. If the message above mentions ' +
        'prepared statements or a lost session, the migration URL is probably ' +
        'pointing at a transaction pooler: set MIGRATIONS_DATABASE_URL to a ' +
        'direct Postgres URL.',
      remedy: [
        'Read the output above — the migrator names the statement it could ' +
          'not apply.',
      ],
    };
  }

  const errorLine = text.match(ERROR_LINE);
  if (errorLine) {
    return {
      ok: false,
      reason: 'drizzle-kit reported an error while exiting 0',
      detail: errorLine[0],
      remedy: [
        'Read the drizzle-kit output above. The exit code cannot be trusted ' +
          'here, so any reported error is treated as a failed migration.',
      ],
    };
  }

  return { ok: true };
}

/**
 * The operator-facing block. One place, so the message stays the same whether
 * the boot is about to abort or has been told to continue anyway.
 *
 * @param {{ reason: string, detail: string, remedy: string[] }} failure
 * @returns {string}
 */
export function formatPushFailure(failure) {
  const lines = [
    '[Boot] Database migration FAILED — the schema was not applied.',
    `[Boot] Reason: ${failure.reason}`,
    `[Boot] ${failure.detail}`,
  ];
  for (const step of failure.remedy) lines.push(`[Boot]   → ${step}`);
  return lines.join('\n');
}
