/**
 * useSourceEditor — programmatic edits to a `<textarea>` that the browser's
 * own undo stack keeps track of, plus the shortcuts that go with them.
 *
 * ## Why this exists
 *
 * A plain textarea already has Ctrl+Z / Ctrl+Shift+Z: the browser records what
 * the user types and can walk it back. Assigning to `value` (or to the ref
 * behind `v-model`) is NOT recorded — it is a change the undo stack never saw,
 * and in every engine it **clears** the stack rather than adding to it. So the
 * moment a toolbar button or a "insert variable" click writes the value
 * directly, the author loses every undo step they had built up, and Ctrl+Z
 * appears to be unbound.
 *
 * That is exactly what happened to the listing-template source editor and to
 * the BBCode "code" mode of `WysiwygEditor`: typing was undoable, one toolbar
 * click was not, and after it nothing was.
 *
 * The fix is to make programmatic edits go in the same way typing does:
 * `document.execCommand('insertText')` inserts at the current selection *as an
 * edit*, so the browser records it, coalesces it sensibly, and Ctrl+Z walks
 * back through it. It is the only API that does this — `beforeinput` cannot be
 * synthesised, and the Undo Manager API never shipped. It is marked deprecated
 * and is nonetheless implemented by every current engine precisely because
 * there is no replacement; `insertText` on a focused textarea is its
 * best-supported case.
 *
 * A direct assignment stays as the fallback, so a browser that refuses the
 * command still edits — it just loses that one step of history rather than the
 * whole feature.
 *
 * ## Why not our own history stack
 *
 * Binding Ctrl+Z ourselves means calling `preventDefault()` on it, which turns
 * off the native behaviour and puts us on the hook for all of it: per-word
 * coalescing, selection restoration, the platform's redo spelling (Ctrl+Y on
 * Windows, Cmd+Shift+Z on macOS), and the interaction with the OS text
 * services. Keeping the native stack alive is less code and behaves the way
 * the rest of the browser does.
 */

/**
 * The section name that disables a block, and why it is a section rather than
 * a comment.
 *
 * The obvious reading of "comment this out" is the grammar's own comment,
 * `{{! … }}`. It does not work: a comment ends at the FIRST `}}`, so wrapping
 * `[b]{{TITLE}}[/b]` produces `{{! [b]{{TITLE}}` as the comment and leaves
 * `[/b] }}` rendering as text. Measured against the real engine, not assumed —
 * `renderTemplate('{{! [b]{{TITLE}}[/b] }}')` returns `"[/b] }}"`. Since almost
 * every line worth disabling contains a variable, a comment button would have
 * silently mangled the common case.
 *
 * A section on a name that is never in the context is exact instead: an unknown
 * variable is falsy, so `{{#OFF}}…{{/OFF}}` renders nothing whatever its body
 * contains, and the body is left byte-for-byte alone. The engine's
 * standalone-line rule then removes the two marker lines cleanly, so switching
 * a block off and on again leaves no blank line behind.
 */
export const DISABLED_BLOCK_NAME = 'OFF';

const OPEN_LINE = new RegExp(`^\\s*\\{\\{#${DISABLED_BLOCK_NAME}\\}\\}\\s*$`);
const CLOSE_LINE = new RegExp(`^\\s*\\{\\{/${DISABLED_BLOCK_NAME}\\}\\}\\s*$`);

/**
 * Wraps a block of lines in `{{#OFF}}` / `{{/OFF}}`, or unwraps it when it is
 * already wrapped.
 *
 * The markers go on their own lines, which is what lets the engine strip them
 * without leaving whitespace behind. Indentation is copied from the first
 * non-blank line so a disabled block still lines up with the scaffolding.
 *
 * Pure and exported so the round trip — disable, enable, get the original back
 * byte for byte — is testable without a DOM. That matters more here than in
 * most editors: a stray space or blank line changes the listing this template
 * emits.
 */
export function toggleDisabledBlock(block: string): string {
  const lines = block.split('\n');
  const first = lines.findIndex((l) => l.trim() !== '');
  const last = (() => {
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i]!.trim() !== '') return i;
    return -1;
  })();
  if (first === -1 || last === -1) return block;

  // Already wrapped: the first and last meaningful lines are the markers.
  if (OPEN_LINE.test(lines[first]!) && CLOSE_LINE.test(lines[last]!) && last > first) {
    return [...lines.slice(0, first), ...lines.slice(first + 1, last), ...lines.slice(last + 1)].join(
      '\n',
    );
  }

  const indent = lines[first]!.match(/^\s*/)?.[0] ?? '';
  return [
    ...lines.slice(0, first),
    `${indent}{{#${DISABLED_BLOCK_NAME}}}`,
    ...lines.slice(first, last + 1),
    `${indent}{{/${DISABLED_BLOCK_NAME}}}`,
    ...lines.slice(last + 1),
  ].join('\n');
}

/** The tag pairs the shortcuts write. `null` close means "no closing tag". */
export interface SourceWrap {
  open: string;
  close: string | null;
}

export interface UseSourceEditorOptions {
  /** Blocks every edit — for a read-only view of somebody else's template. */
  readonly?: () => boolean;
}

export function useSourceEditor(
  elRef: Ref<HTMLTextAreaElement | null | undefined>,
  options: UseSourceEditorOptions = {},
) {
  const blocked = () => options.readonly?.() ?? false;

  /**
   * Replaces [start, end) with `text`, recorded in the browser's undo stack.
   *
   * Returns false when the edit had to fall back to a direct assignment, which
   * the caller needs to know: the fallback does not emit `input`, so a
   * `v-model` bound to the element would not see it.
   */
  function replaceRange(start: number, end: number, text: string): boolean {
    const el = elRef.value;
    if (!el || blocked()) return true;

    el.focus();
    el.setSelectionRange(start, end);

    // `insertText` with an empty string is a no-op in some engines rather than
    // a deletion, so deleting goes through the same path as a replacement by
    // way of the selection itself.
    try {
      if (document.execCommand('insertText', false, text)) return true;
    } catch {
      // Fall through — some engines throw rather than returning false.
    }

    // Fallback: the edit happens, the history step does not. An `input` event
    // is dispatched by hand so v-model and any listener still see the change.
    const before = el.value.slice(0, start);
    const after = el.value.slice(end);
    el.value = before + text + after;
    const caret = start + text.length;
    el.setSelectionRange(caret, caret);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return false;
  }

  /** Inserts at the caret, replacing the selection if there is one. */
  function insert(text: string) {
    const el = elRef.value;
    if (!el || blocked()) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    replaceRange(start, end, text);
  }

  /** Replaces the whole body — used by "reset" and "revert". */
  function replaceAll(text: string) {
    const el = elRef.value;
    if (!el || blocked()) return;
    replaceRange(0, el.value.length, text);
  }

  /**
   * Wraps the selection in a tag pair, or drops an empty pair at the caret.
   *
   * The selection is restored ON the wrapped text afterwards, not collapsed
   * after it: wrapping the same words in a second tag is the common next move
   * (`[b]` then `[color=…]`), and re-selecting by hand each time is the kind of
   * friction that makes people go back to typing the tags out.
   */
  function wrap({ open, close }: SourceWrap) {
    const el = elRef.value;
    if (!el || blocked()) return;
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? start;
    const selected = el.value.slice(start, end);
    const closing = close ?? '';
    replaceRange(start, end, `${open}${selected}${closing}`);
    // After the edit the caret sits past everything; put the selection back on
    // the text itself (or between the tags when there was no selection).
    const inner = start + open.length;
    nextTick(() => {
      el.focus();
      el.setSelectionRange(inner, inner + selected.length);
    });
  }

  /**
   * Switches the selected lines off, or back on — see toggleDisabledBlock for
   * why this is a section and not a comment.
   */
  function toggleDisabled() {
    const el = elRef.value;
    if (!el || blocked()) return;
    const value = el.value;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    // Grow the range to whole lines — see toggleCommentBlock for why.
    const from = value.lastIndexOf('\n', start - 1) + 1;
    const nl = value.indexOf('\n', end);
    const to = nl === -1 ? value.length : nl;
    const next = toggleDisabledBlock(value.slice(from, to));
    replaceRange(from, to, next);
    nextTick(() => {
      el.focus();
      el.setSelectionRange(from, from + next.length);
    });
  }

  /**
   * The shortcuts, as a keydown handler.
   *
   * Ctrl/Cmd+Z and its redo spellings are deliberately absent: they are the
   * browser's, and the whole point of routing edits through `insertText` is
   * that they keep working. Anything listed here is a formatting action the
   * platform has no opinion about.
   */
  function onKeydown(event: KeyboardEvent) {
    if (blocked()) return;
    // `metaKey` for macOS, `ctrlKey` elsewhere. Never both: Ctrl+Cmd+B is a
    // system gesture on macOS and should not be swallowed.
    const mod = event.metaKey !== event.ctrlKey;
    if (!mod || event.altKey) return;

    const key = event.key.toLowerCase();
    const actions: Record<string, () => void> = {
      b: () => wrap({ open: '[b]', close: '[/b]' }),
      i: () => wrap({ open: '[i]', close: '[/i]' }),
      u: () => wrap({ open: '[u]', close: '[/u]' }),
      // Cmd/Ctrl+K is "insert link" in every editor the user has met.
      k: () => wrap({ open: '[url=]', close: '[/url]' }),
      '/': () => toggleDisabled(),
    };
    const action = actions[key];
    if (!action) return;
    // Only now: an unhandled combination must keep its native meaning
    // (Ctrl+A, Ctrl+F, Ctrl+Home … all still belong to the browser).
    event.preventDefault();
    action();
  }

  return { insert, replaceAll, wrap, toggleDisabled, onKeydown, replaceRange };
}
