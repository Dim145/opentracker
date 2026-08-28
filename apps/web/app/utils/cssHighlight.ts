/**
 * A small CSS scanner, for colouring the owner's free-form CSS as it is typed.
 *
 * ## Why this is not a dependency
 *
 * The obvious answers were weighed and both lose here.
 *
 * **CodeMirror 6** is the capable one, and it is disqualified by this
 * application's own CSP: it creates `<style>` elements at runtime, has no API
 * for handing them a nonce, and `apps/web/server/plugins/csp.ts` now requires
 * one on every style element. Loosening `style-src-elem` to fit an editor widget
 * would trade a real property — an injected stylesheet does nothing — for a
 * convenience in one admin panel. (Its dev repository was also archived in
 * April 2026, so the nonce gap is not going to close.)
 *
 * **Prism, and the editors built on it,** would work, and would still be a new
 * runtime dependency added to a repository whose install runs a supply-chain
 * policy over the lockfile. For a hundred lines of scanning over a grammar this
 * small, that is a poor trade.
 *
 * ## What it is, and what it is not
 *
 * A scanner, not a parser. It produces a flat run of coloured spans and never
 * builds a tree, because colouring does not need one and a wrong colour costs
 * nothing. That is the whole reason it is allowed to be approximate.
 *
 * **It has no authority whatsoever.** `apps/api/utils/themeCss.ts` decides what
 * is accepted, with `css-tree`, on the server, and it regenerates its output
 * from the AST so a browser never sees the bytes typed here. The `refused`
 * marks below are a courtesy — they tell an owner what the server is going to
 * say before they press save. An owner who defeats them has defeated nothing.
 */
import {
  ALLOWED_AT_RULES,
  ALLOWED_FUNCTIONS,
  REFUSED_PROPERTIES,
} from '@trackarr/shared/css';

export type CssTokenType =
  | 'comment'
  | 'atrule'
  | 'selector'
  | 'property'
  | 'value'
  | 'string'
  | 'number'
  | 'function'
  | 'punct';

export interface CssToken {
  readonly type: CssTokenType;
  readonly text: string;
  /**
   * Set when the server is going to refuse this, with the reason it will give.
   *
   * A hint, never a gate — see the note above.
   */
  readonly refused?: string;
}

/** An at-rule's name is an identifier, which is all this has to scan. */
const IDENT = /[-\w]/;

/** `url()` is refused by name, because the generic message would bury the point. */
const URL_REFUSAL =
  'url() is refused: it tells another server who visited the page.';

function functionRefusal(name: string): string | undefined {
  const lower = name.toLowerCase();
  if (lower === 'url') return URL_REFUSAL;
  if (ALLOWED_FUNCTIONS.has(lower)) return undefined;
  return `${name}() is refused: not one of the functions a theme may call.`;
}

/**
 * Scan `src` into coloured spans.
 *
 * Every character of the input appears in exactly one token, in order, so
 * `tokens.map(t => t.text).join('')` is the input again. The editor overlays
 * this on a real `<textarea>`, and the two only stay aligned if nothing is
 * dropped — including whitespace, which rides along with whatever token it
 * follows.
 */
export function tokenizeCss(src: string): CssToken[] {
  const out: CssToken[] = [];
  const push = (type: CssTokenType, text: string, refused?: string) => {
    if (text) out.push(refused ? { type, text, refused } : { type, text });
  };

  let i = 0;
  // A stack rather than a depth counter: `@media { .a { … } }` puts selectors at
  // one level and declarations at the next, and only the block's opener knows
  // which kind it is.
  const blocks: Array<'decl' | 'nested'> = [];
  const inDeclarations = () => blocks[blocks.length - 1] === 'decl';
  let expectingValue = false;
  // Whether the `{` about to be read closes an at-rule's prelude. Tracked
  // explicitly rather than inferred by looking back at the text before the
  // brace: that lookback started at the last punctuation mark, so
  // `@media (min-width: 10px) {` lost sight of the `@` behind its own
  // parentheses and opened a block of declarations. The tests caught it as a
  // `:not(` inside that block being read as a value's function.
  let atRulePrelude = false;
  let pending = '';

  const flush = () => {
    if (!pending) return;
    push(
      inDeclarations() ? (expectingValue ? 'value' : 'property') : 'selector',
      pending,
    );
    pending = '';
  };

  while (i < src.length) {
    const c = src[i]!;

    // ── Comments ─────────────────────────────────────────────────────
    if (c === '/' && src[i + 1] === '*') {
      flush();
      const end = src.indexOf('*/', i + 2);
      const stop = end === -1 ? src.length : end + 2;
      push('comment', src.slice(i, stop));
      i = stop;
      continue;
    }

    // ── Strings ──────────────────────────────────────────────────────
    if (c === '"' || c === "'") {
      flush();
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      push('string', src.slice(i, Math.min(j + 1, src.length)));
      i = j + 1;
      continue;
    }

    // ── At-rules ─────────────────────────────────────────────────────
    if (c === '@' && !inDeclarations()) {
      flush();
      let j = i + 1;
      while (j < src.length && IDENT.test(src[j]!)) j++;
      const name = src.slice(i + 1, j);
      atRulePrelude = true;
      push(
        'atrule',
        src.slice(i, j),
        ALLOWED_AT_RULES.has(name.toLowerCase())
          ? undefined
          : `@${name} is refused: only @${[...ALLOWED_AT_RULES].join(', @')} are allowed.`,
      );
      i = j;
      continue;
    }

    // ── Structure ────────────────────────────────────────────────────
    if (c === '{') {
      // An at-rule prelude opens a block of RULES; anything else opens a block
      // of declarations. `@keyframes` is the case that makes it matter: `from {`
      // and `50% {` inside it are selectors, not properties.
      flush();
      blocks.push(atRulePrelude ? 'nested' : 'decl');
      atRulePrelude = false;
      expectingValue = false;
      push('punct', c);
      i++;
      continue;
    }
    if (c === '}') {
      flush();
      blocks.pop();
      expectingValue = false;
      push('punct', c);
      i++;
      continue;
    }
    if (c === ';') {
      flush();
      // `@import "x";` ends here rather than at a brace.
      atRulePrelude = false;
      expectingValue = false;
      push('punct', c);
      i++;
      continue;
    }
    if (c === ':' && inDeclarations() && !expectingValue) {
      // The property name just ended. Refuse it here rather than at the value,
      // so the mark sits on the word the owner has to remove.
      const name = pending.trim().toLowerCase();
      const refusal = REFUSED_PROPERTIES[name];
      push('property', pending, refusal);
      pending = '';
      expectingValue = true;
      push('punct', c);
      i++;
      continue;
    }

    // ── Functions ────────────────────────────────────────────────────
    if (c === '(') {
      const name = /([-\w]+)\s*$/.exec(pending)?.[1];
      if (name) {
        const before = pending.slice(0, pending.length - name.length);
        push(
          inDeclarations() ? (expectingValue ? 'value' : 'property') : 'selector',
          before,
        );
        // Only a value's functions are judged. In a selector the same shape is
        // a pseudo-class — `:not(`, `:is(`, `:has(`, `:nth-child(` — and the
        // server knows the difference because css-tree gives them a different
        // node type. Flagging them here would put a red mark under working CSS,
        // which is worse than the miss in the other direction: an at-rule
        // prelude's functions go unchecked, and the server still refuses them.
        push(
          'function',
          name,
          expectingValue ? functionRefusal(name) : undefined,
        );
        pending = '';
      } else {
        flush();
      }
      push('punct', c);
      i++;
      continue;
    }
    if (c === ')') {
      flush();
      push('punct', c);
      i++;
      continue;
    }

    // ── Numbers, in a value ──────────────────────────────────────────
    if (expectingValue && /[\d.]/.test(c) && !/[-\w]$/.test(pending)) {
      const m = /^[+-]?(?:\d*\.\d+|\d+)(?:[a-z%]+)?/i.exec(src.slice(i));
      if (m) {
        flush();
        push('number', m[0]);
        i += m[0].length;
        continue;
      }
    }

    pending += c;
    i++;
  }
  flush();
  return out;
}

/** Everything the server will refuse, in source order. */
export function cssRefusals(src: string): Array<{ text: string; reason: string }> {
  return tokenizeCss(src)
    .filter((t) => t.refused)
    .map((t) => ({ text: t.text.trim(), reason: t.refused! }));
}

/**
 * Re-indent, without reformatting.
 *
 * Deliberately modest: one statement per line and two spaces per nesting level,
 * and nothing else touched. A real pretty-printer would need the parser this
 * module does not have, and the server's own output is minified — so the honest
 * scope here is "make what I typed readable", not "normalise it".
 */
export function formatCss(src: string): string {
  const out: string[] = [];
  let depth = 0;
  let line = '';
  const flush = () => {
    const text = line.trim();
    if (text) out.push('  '.repeat(Math.max(0, depth)) + text);
    line = '';
  };

  for (const token of tokenizeCss(src)) {
    if (token.type === 'comment') {
      // A comment keeps its own line, and its own text verbatim — reflowing one
      // is how a carefully aligned note becomes noise.
      flush();
      out.push('  '.repeat(Math.max(0, depth)) + token.text.trim());
      continue;
    }
    if (token.type === 'punct' && token.text === '{') {
      // `trimEnd` first: the source may already have a space before the brace,
      // and appending another is what stopped this being idempotent.
      line = `${line.trimEnd()} {`;
      flush();
      depth++;
      continue;
    }
    if (token.type === 'punct' && token.text === '}') {
      // The last declaration in a block is allowed to omit its semicolon, and
      // dropping it here would silently join it to whatever came next the second
      // time this ran.
      if (line.trim()) line = `${line.trimEnd()};`;
      flush();
      depth--;
      out.push('  '.repeat(Math.max(0, depth)) + '}');
      continue;
    }
    if (token.type === 'punct' && token.text === ';') {
      line += ';';
      flush();
      continue;
    }
    line += token.type === 'punct' && token.text === ':' ? ': ' : token.text;
    // Collapse the runs of whitespace the source may carry, but only inside a
    // line: the newlines are being decided here, not preserved.
    line = line.replace(/\s+/g, ' ');
  }
  flush();
  return out.join('\n');
}
