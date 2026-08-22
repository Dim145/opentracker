/**
 * Reject a template whose grammar cannot be parsed, at the door.
 *
 * The cap on `content` is enforced by zod on every write route, but the cap
 * says nothing about structure: an unclosed `{{#SECTION}}` stored fine and only
 * failed at render — and once it reached the site catalogue it failed for every
 * viewer instead of for its author.
 *
 * The parser is the same one the browser renders with (it moved into
 * @trackarr/shared for exactly this), so a template that passes here cannot
 * throw there. Cheap by construction: parsing is linear and every route caps
 * the body at 15 kB.
 *
 * One copy, called from all four write routes — the two member ones and the two
 * admin ones. It used to be pasted into each handler, which is how the comment
 * above `content` in the create route ended up claiming the server did not
 * validate grammar at all while the line below it did.
 */
import { TemplateError, assertTemplateValid } from '@trackarr/shared/templateEngine';

export function assertTemplateGrammar(content: string): void {
  try {
    assertTemplateValid(content);
  } catch (err) {
    throw createError({
      statusCode: 400,
      message:
        err instanceof TemplateError
          ? `Template syntax error — ${err.message}`
          : 'Template syntax error',
    });
  }
}
