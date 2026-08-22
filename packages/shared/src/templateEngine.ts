/**
 * Mustache-subset renderer for user-editable listing templates.
 *
 * Hand-written rather than a dependency because the templates come from users
 * and every complete Mustache implementation ships features we must not hand
 * them: partials read files, lambdas execute code, dotted paths walk into
 * arbitrary objects. Here the grammar is four tags over a flat bag of strings,
 * small enough to audit in one sitting — no dynamic code, and the only pattern
 * ever compiled is the fixed name check below, so a template can neither run
 * anything nor be crafted into a pathological pattern.
 *
 * Three rules are load-bearing rather than cosmetic:
 *
 * 1. STANDALONE LINES. A section tag alone on its line consumes that line
 *    whole, newline included. Without it the default listing template cannot
 *    reproduce the blank lines of the original generator: each `{{#SECTION}}`
 *    would leave an empty line behind and the output would drift by one
 *    newline per section.
 * 2. The closing `\n{4,}` collapse runs over the WHOLE rendered string, never
 *    per variable. A synopsis pasted with five blank lines is exactly what it
 *    is there for, and collapsing per variable gives a different answer.
 * 3. An unknown variable renders empty, but a broken section throws. Missing
 *    data is normal — a listing with no rating — whereas an unclosed section
 *    means the remainder of the template is being read as section body, and
 *    swallowing that silently produces a listing quietly missing its last
 *    third.
 */

/** A section is truthy on any non-empty string; `''`, `false`, null and undefined are not. */
export type TemplateValue = string | boolean | null | undefined;

/** Flat by design: no nesting to walk, so no path traversal to reason about. */
export type TemplateContext = Record<string, TemplateValue>;

export interface RenderLimits {
  /**
   * Rendering happens in a `computed` on every keystroke of the editor, so a
   * runaway template must fail rather than lock the tab up.
   */
  maxOutputChars?: number;
  /** Section nesting; deep nesting is always a mistake, never a need. */
  maxDepth?: number;
}

/**
 * Generous next to a real listing (~2 kB) and next to the 10 000-character cap
 * the upload route applies to a description, so it only ever catches abuse.
 */
const DEFAULT_MAX_OUTPUT = 200_000;
const DEFAULT_MAX_DEPTH = 16;

/**
 * The ONLY pattern applied to anything coming out of a template, and it is
 * fixed: names are matched against it, never compiled from it. Uppercase is
 * the convention, mixed case is tolerated so a hand-written template is not
 * rejected over a detail.
 */
const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Line-internal whitespace only — a `\n` can never appear in the slices tested. */
const BLANK_PATTERN = /^[ \t]*$/;

export class TemplateError extends Error {
  /** 1-based, or undefined for a failure with no single position (the size cap). */
  readonly line: number | undefined;

  constructor(message: string, line?: number) {
    super(line === undefined ? message : `${message} (line ${line})`);
    this.name = 'TemplateError';
    this.line = line;
  }
}

type Node =
  | { kind: 'text'; text: string }
  | { kind: 'var'; name: string }
  | { kind: 'section'; name: string; inverted: boolean; body: Node[] };

interface OpenSection {
  name: string;
  line: number;
  body: Node[];
}

/** Sigils of the wider Mustache grammar we deliberately refuse, and why. */
const REFUSED: Record<string, string> = {
  '{': 'triple mustache (unescaped output)',
  '&': 'unescaped output',
  '>': 'partials',
  '<': 'parent blocks',
  '$': 'block parameters',
  '=': 'delimiter changes',
  '%': 'pragmas',
};

function parse(template: string, maxDepth: number): Node[] {
  const root: Node[] = [];
  const open: OpenSection[] = [];
  let pos = 0;

  // Newlines are counted once, moving forward with the scan. Reaching for
  // `lastIndexOf('\n')` per tag to find the current line instead — the obvious
  // way to write the standalone check below — makes the parse quadratic: a
  // template with no newlines and 60 000 tags took two and a half seconds that
  // way, and it renders on every keystroke of the editor.
  let counted = 0;
  let countedLine = 1;
  let countedLineStart = 0;
  const advanceTo = (index: number) => {
    for (let i = counted; i < index; i++) {
      if (template.charCodeAt(i) === 10) {
        countedLine++;
        countedLineStart = i + 1;
      }
    }
    counted = index;
  };

  const body = (): Node[] => (open.length ? open[open.length - 1]!.body : root);
  const pushText = (text: string) => {
    if (text) body().push({ kind: 'text', text });
  };

  for (;;) {
    const start = template.indexOf('{{', pos);
    if (start < 0) {
      pushText(template.slice(pos));
      break;
    }
    const end = template.indexOf('}}', start + 2);
    advanceTo(start);
    const line = countedLine;
    if (end < 0) {
      throw new TemplateError('A "{{" is never closed by a "}}"', line);
    }

    const inner = template.slice(start + 2, end);
    const sigil = inner.slice(0, 1);
    const refused = REFUSED[sigil];
    if (refused) {
      throw new TemplateError(
        `"{{${sigil}" is not supported (${refused}) — the template syntax is {{VARIABLE}}, {{#VARIABLE}}…{{/VARIABLE}}, {{^VARIABLE}}…{{/VARIABLE}} and {{! comment }}`,
        line,
      );
    }

    const isTag = sigil === '#' || sigil === '^' || sigil === '/' || sigil === '!';
    const name = isTag ? inner.slice(1).trim() : inner.trim();
    if (sigil !== '!' && !NAME_PATTERN.test(name)) {
      throw new TemplateError(
        `"${name}" is not a usable variable name — use a letter or "_" then letters, digits and "_"`,
        line,
      );
    }

    // A tag alone on its line takes the line with it. Judged on the raw source
    // rather than on what has been emitted so far, which is what makes a line
    // holding two tags correctly count as not standalone.
    let next = end + 2;
    let before = template.slice(pos, start);
    if (isTag) {
      const lineStart = countedLineStart;
      const indent = template.slice(lineStart, start);
      let after = next;
      while (after < template.length && (template[after] === ' ' || template[after] === '\t')) {
        after++;
      }
      let eol = -1;
      if (after >= template.length) eol = after;
      else if (template[after] === '\n') eol = after + 1;
      else if (template[after] === '\r' && template[after + 1] === '\n') eol = after + 2;
      if (eol >= 0 && BLANK_PATTERN.test(indent)) {
        before = template.slice(pos, Math.max(pos, lineStart));
        next = eol;
      }
    }
    pushText(before);
    pos = next;

    if (sigil === '!') continue;
    if (sigil === '#' || sigil === '^') {
      if (open.length >= maxDepth) {
        throw new TemplateError(`Sections are nested more than ${maxDepth} deep`, line);
      }
      const sectionBody: Node[] = [];
      body().push({ kind: 'section', name, inverted: sigil === '^', body: sectionBody });
      open.push({ name, line, body: sectionBody });
      continue;
    }
    if (sigil === '/') {
      const current = open.pop();
      if (!current) {
        throw new TemplateError(`{{/${name}}} closes a section that was never opened`, line);
      }
      if (current.name !== name) {
        throw new TemplateError(
          `{{/${name}}} does not close {{#${current.name}}}, opened on line ${current.line}`,
          line,
        );
      }
      continue;
    }
    body().push({ kind: 'var', name });
  }

  const unclosed = open.pop();
  if (unclosed) {
    throw new TemplateError(
      `{{#${unclosed.name}}} is never closed — add {{/${unclosed.name}}}`,
      unclosed.line,
    );
  }
  return root;
}

/** `''`, `false`, null and undefined hide a section; everything else shows it. */
function truthy(value: TemplateValue): boolean {
  return value !== undefined && value !== null && value !== false && value !== '';
}

/**
 * Renders `template` against `context`.
 *
 * The closing pass is the one `buildFiche` has always applied: collapse four
 * newlines or more down to three, then trim. It is part of the listing format,
 * not a tidy-up — see the header.
 *
 * @throws {TemplateError} on a malformed template or an oversized render.
 */
export function renderTemplate(
  template: string,
  context: TemplateContext = {},
  limits: RenderLimits = {},
): string {
  const maxOutput = limits.maxOutputChars ?? DEFAULT_MAX_OUTPUT;
  const nodes = parse(template, limits.maxDepth ?? DEFAULT_MAX_DEPTH);

  const chunks: string[] = [];
  let size = 0;
  const emit = (value: string) => {
    if (!value) return;
    size += value.length;
    if (size > maxOutput) {
      throw new TemplateError(`The rendered listing exceeds ${maxOutput} characters`);
    }
    chunks.push(value);
  };

  // Depth is capped at parse time, so plain recursion cannot blow the stack.
  const walk = (list: Node[]) => {
    for (const node of list) {
      if (node.kind === 'text') {
        emit(node.text);
      } else if (node.kind === 'var') {
        const value = context[node.name];
        // An unknown or empty variable renders as nothing: a listing without a
        // rating is a normal listing.
        emit(value === undefined || value === null ? '' : String(value));
      } else if (truthy(context[node.name]) !== node.inverted) {
        walk(node.body);
      }
    }
  };
  walk(nodes);

  return chunks.join('').replace(/\n{4,}/g, '\n\n\n').trim();
}

/**
 * Same verdict as `renderTemplate` on the template itself, with no context
 * needed — for validating what a user typed before storing it.
 *
 * @throws {TemplateError}
 */
export function assertTemplateValid(template: string, limits: RenderLimits = {}): void {
  parse(template, limits.maxDepth ?? DEFAULT_MAX_DEPTH);
}

/**
 * Every name a template refers to, in order of first appearance, sections
 * included. The editor uses it to flag a name that is not in the catalogue —
 * the typo `{{TITRE}}` is otherwise invisible, since an unknown variable
 * renders empty by design.
 *
 * @throws {TemplateError} on a malformed template.
 */
export function templateVariables(template: string, limits: RenderLimits = {}): string[] {
  const seen = new Set<string>();
  const walk = (list: Node[]) => {
    for (const node of list) {
      if (node.kind === 'text') continue;
      seen.add(node.name);
      if (node.kind === 'section') walk(node.body);
    }
  };
  walk(parse(template, limits.maxDepth ?? DEFAULT_MAX_DEPTH));
  return [...seen];
}
