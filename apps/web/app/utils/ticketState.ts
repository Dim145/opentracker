/**
 * The word for a ticket, from the two facts that are actually stored.
 *
 * The database keeps `status` (open | closed) and, when closed, a
 * `closureReason`. That is the whole life cycle, because everything else
 * a helpdesk is tempted to store there can be derived and would otherwise
 * be free to disagree with itself — a ticket marked "assigned" with no
 * assignee is a bug that only exists if you write the state down twice.
 *
 * This is the other half of that bargain: one place that turns those two
 * columns into the five words people actually use, so the queue and the
 * thread cannot end up calling the same ticket different things.
 */
export type TicketState =
  | 'open'
  | 'taken'
  | 'resolved'
  | 'rejected'
  | 'stale'
  | 'withdrawn';

export interface TicketStateInput {
  status: string;
  closureReason?: string | null;
  assignedToId?: string | null;
}

export function ticketState(t: TicketStateInput): TicketState {
  if (t.status !== 'open') {
    const reason = t.closureReason;
    return reason === 'rejected' || reason === 'stale' || reason === 'withdrawn'
      ? reason
      : 'resolved';
  }
  return t.assignedToId ? 'taken' : 'open';
}

/** True while either side may still write to it. */
export function ticketIsOpen(t: { status: string }): boolean {
  return t.status === 'open';
}

const ICONS: Record<TicketState, string> = {
  open: 'ph:circle-dashed-bold',
  taken: 'ph:user-check-bold',
  resolved: 'ph:check-circle-bold',
  rejected: 'ph:x-circle-bold',
  stale: 'ph:clock-countdown-bold',
  withdrawn: 'ph:check-circle-bold',
};

export function ticketStateIcon(state: TicketState): string {
  return ICONS[state];
}
