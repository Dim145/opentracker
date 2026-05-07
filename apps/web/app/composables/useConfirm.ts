/**
 * useConfirm — promise-based replacement for `window.confirm()`.
 *
 * Pattern:
 *
 *   const confirm = useConfirm();
 *   const ok = await confirm({
 *     title: 'Delete torrent?',
 *     message: `This permanently removes "${name}".`,
 *     confirmText: 'Delete',
 *     destructive: true,
 *   });
 *   if (!ok) return;
 *
 * Backed by a single Vue state shared across the app. The actual dialog DOM
 * lives in <ConfirmHost /> mounted once in layouts/default.vue. Open requests
 * push a payload onto the queue; the host renders the topmost one.
 */

export interface ConfirmRequest {
  id: number;
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
  resolve: (ok: boolean) => void;
}

export interface ConfirmOptions {
  title: string;
  message?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
}

let nextId = 1;

export function useConfirmState() {
  // Shared queue across the app. useState makes it SSR-safe (the queue stays
  // empty during SSR; dialogs only ever appear in response to user clicks).
  return useState<ConfirmRequest[]>('trackarr.confirm.queue', () => []);
}

export function useConfirm() {
  const queue = useConfirmState();

  return function confirm(opts: ConfirmOptions): Promise<boolean> {
    return new Promise((resolve) => {
      queue.value = [
        ...queue.value,
        {
          id: nextId++,
          title: opts.title,
          message: opts.message,
          confirmText: opts.confirmText,
          cancelText: opts.cancelText,
          destructive: opts.destructive,
          resolve,
        },
      ];
    });
  };
}
