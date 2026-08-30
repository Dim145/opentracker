import { describe, it, expect, beforeEach } from 'vitest';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, schema } from '@trackarr/db';
import { makeUser } from './helpers';
import {
  sweepDmRetention,
  sweepRoomRetention,
  sweepTicketRetention,
} from '../../utils/messaging/retention';
import { setSetting, SETTINGS_KEYS } from '../../utils/settings';

/**
 * The two message sweeps that delete member content.
 *
 * Neither had a test. That matters more here than for most jobs, because
 * both live behind a plugin-level try/catch that turns any failure into a
 * `console.warn` — the exact shape that let the notification sweep ship
 * broken for months while every operator believed it was running.
 *
 * So what is pinned below is the boundary on both sides, and the refusals:
 * a sweep that deletes one row too many is indistinguishable, in a log
 * line, from one that works.
 */

const DAY = 86_400_000;

async function makeConversation(a: string, b: string): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.conversations).values({ id, kind: 'dm', createdById: a });
  await db.insert(schema.conversationParticipants).values([
    { conversationId: id, userId: a, state: 'active' },
    { conversationId: id, userId: b, state: 'active' },
  ]);
  return id;
}

async function makeMessage(
  conversationId: string,
  authorId: string,
  ageDays: number
): Promise<string> {
  const id = randomUUID();
  await db.insert(schema.messages).values({
    id,
    conversationId,
    authorId,
    body: `age ${ageDays}d`,
    createdAt: new Date(Date.now() - ageDays * DAY),
  });
  return id;
}

const messageExists = async (id: string) =>
  (await db.select({ id: schema.messages.id }).from(schema.messages).where(eq(schema.messages.id, id)))
    .length > 0;

describe('private-message retention', () => {
  let alice = '';
  let bob = '';
  let conv = '';

  beforeEach(async () => {
    alice = await makeUser();
    bob = await makeUser();
    conv = await makeConversation(alice, bob);
  });

  it('is off at zero, which is the shipped default', async () => {
    await setSetting(SETTINGS_KEYS.MESSAGING_DM_RETENTION_DAYS, '0');
    const ancient = await makeMessage(conv, alice, 900);

    expect(await sweepDmRetention()).toBe(0);
    expect(await messageExists(ancient)).toBe(true);
  });

  it('deletes past the cutoff and keeps what is inside it', async () => {
    await setSetting(SETTINGS_KEYS.MESSAGING_DM_RETENTION_DAYS, '30');
    // One clearly outside, one clearly inside. The boundary itself is
    // deliberately not tested to the second: the cutoff moves with the
    // clock, and a test that races it is worse than no test.
    const old = await makeMessage(conv, alice, 40);
    const recent = await makeMessage(conv, bob, 5);

    const removed = await sweepDmRetention();

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await messageExists(old)).toBe(false);
    expect(await messageExists(recent)).toBe(true);
  });

  it('follows the setting rather than a hardcoded number', async () => {
    const twoMonths = await makeMessage(conv, alice, 60);

    await setSetting(SETTINGS_KEYS.MESSAGING_DM_RETENTION_DAYS, '90');
    await sweepDmRetention();
    expect(await messageExists(twoMonths)).toBe(true);

    await setSetting(SETTINGS_KEYS.MESSAGING_DM_RETENTION_DAYS, '30');
    await sweepDmRetention();
    expect(await messageExists(twoMonths)).toBe(false);
  });

  it('is a no-op the second time', async () => {
    await setSetting(SETTINGS_KEYS.MESSAGING_DM_RETENTION_DAYS, '30');
    await makeMessage(conv, alice, 40);

    expect(await sweepDmRetention()).toBeGreaterThanOrEqual(1);
    expect(await sweepDmRetention()).toBe(0);
  });

  it('leaves the room alone — a different table, a different setting', async () => {
    await setSetting(SETTINGS_KEYS.MESSAGING_DM_RETENTION_DAYS, '1');
    const before = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.roomMessages);

    await sweepDmRetention();

    const after = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.roomMessages);
    expect(after[0]!.n).toBe(before[0]!.n);
  });
});

/** A ticket in a chosen state, with one line on it. */
async function makeTicket(over: Partial<typeof schema.tickets.$inferInsert> = {}) {
  const opener = await makeUser();
  const id = randomUUID();
  await db.insert(schema.tickets).values({
    id,
    openedById: opener,
    openedByName: `u_${id.slice(0, 6)}`,
    subject: 'A ticket',
    lastMessageAt: new Date(),
    ...over,
  });
  return id;
}

const ticketRow = async (id: string) =>
  (await db.select().from(schema.tickets).where(eq(schema.tickets.id, id)))[0]!;

describe('ticket auto-close', () => {
  beforeEach(async () => {
    await setSetting(SETTINGS_KEYS.TICKETS_MODE, 'on');
    // Nothing must be left warned from a previous case, or the close pass
    // of one test would act on another's fixture.
    await db.update(schema.tickets).set({ idleNoticeAt: null });
  });

  it('does nothing at all while the desk is off', async () => {
    await setSetting(SETTINGS_KEYS.TICKETS_MODE, 'off');
    const t = await makeTicket({
      lastMessageBy: 'staff',
      lastMessageAt: new Date(Date.now() - 100 * DAY),
    });

    expect(await sweepTicketRetention()).toEqual({ warned: 0, closed: 0 });
    expect((await ticketRow(t)).status).toBe('open');
  });

  it('nor while it is merely suspended', async () => {
    await setSetting(SETTINGS_KEYS.TICKETS_MODE, 'suspended');
    await makeTicket({
      lastMessageBy: 'staff',
      lastMessageAt: new Date(Date.now() - 100 * DAY),
    });
    expect(await sweepTicketRetention()).toEqual({ warned: 0, closed: 0 });
  });

  it('warns, and does not close on the same pass', async () => {
    const t = await makeTicket({
      lastMessageBy: 'staff',
      lastMessageAt: new Date(Date.now() - 25 * DAY),
    });

    const first = await sweepTicketRetention();
    expect(first.warned).toBeGreaterThanOrEqual(1);
    expect(first.closed).toBe(0);

    const row = await ticketRow(t);
    expect(row.status).toBe('open');
    expect(row.idleNoticeAt).not.toBeNull();
  });

  it('never touches one the staff has not answered', async () => {
    // The whole point of the `lastMessageBy` condition: closing these
    // would let the desk absolve itself of its own silence.
    const t = await makeTicket({
      lastMessageBy: 'member',
      lastMessageAt: new Date(Date.now() - 400 * DAY),
    });

    await sweepTicketRetention();
    await sweepTicketRetention();

    const row = await ticketRow(t);
    expect(row.status).toBe('open');
    expect(row.idleNoticeAt).toBeNull();
  });

  it('never touches one somebody has taken', async () => {
    const holder = await makeUser();
    const t = await makeTicket({
      lastMessageBy: 'staff',
      lastMessageAt: new Date(Date.now() - 400 * DAY),
      assignedToId: holder,
      assignedToName: 'a moderator',
    });

    await sweepTicketRetention();
    expect((await ticketRow(t)).idleNoticeAt).toBeNull();
  });

  it('closes as stale once the grace has run out, attributed to the system', async () => {
    const t = await makeTicket({
      lastMessageBy: 'staff',
      lastMessageAt: new Date(Date.now() - 40 * DAY),
      idleNoticeAt: new Date(Date.now() - 8 * DAY),
    });

    const pass = await sweepTicketRetention();
    expect(pass.closed).toBeGreaterThanOrEqual(1);

    const row = await ticketRow(t);
    expect(row.status).toBe('closed');
    expect(row.closureReason).toBe('stale');
    expect(row.closedById).toBeNull();
    expect(row.closedByName).toBe('system');
  });

  it('does not close one still inside its grace period', async () => {
    const t = await makeTicket({
      lastMessageBy: 'staff',
      lastMessageAt: new Date(Date.now() - 25 * DAY),
      idleNoticeAt: new Date(Date.now() - 2 * DAY),
    });

    await sweepTicketRetention();
    expect((await ticketRow(t)).status).toBe('open');
  });

  it('is a no-op the second time', async () => {
    await makeTicket({
      lastMessageBy: 'staff',
      lastMessageAt: new Date(Date.now() - 40 * DAY),
      idleNoticeAt: new Date(Date.now() - 8 * DAY),
    });

    const first = await sweepTicketRetention();
    expect(first.closed).toBeGreaterThanOrEqual(1);
    const second = await sweepTicketRetention();
    expect(second.closed).toBe(0);
  });

  it('leaves a closed ticket where it is', async () => {
    const t = await makeTicket({
      status: 'closed',
      closureReason: 'resolved',
      closedByName: 'a moderator',
      lastMessageBy: 'staff',
      lastMessageAt: new Date(Date.now() - 400 * DAY),
      idleNoticeAt: new Date(Date.now() - 400 * DAY),
    });

    await sweepTicketRetention();
    expect((await ticketRow(t)).closureReason).toBe('resolved');
  });
});

/**
 * The room sweep is partition maintenance rather than a DELETE: it rolls
 * partitions forward and drops the ones whose whole range has aged out.
 * It has shipped broken twice — once creating and never dropping, once
 * unable to report what it had done — so what is pinned here is that it
 * both creates ahead and drops behind, and that it never takes a
 * partition straddling the cutoff.
 */
describe('room partition retention', () => {
  const partitionsOf = async (parent: string): Promise<string[]> => {
    const rows = await db.execute<{ relname: string }>(sql`
      SELECT c.relname
        FROM pg_inherits i
        JOIN pg_class c ON c.oid = i.inhrelid
       WHERE i.inhparent = ${sql.raw(`'${parent}'`)}::regclass
         AND c.relname ~ ${sql.raw(`'^${parent}_[0-9]{8}$'`)}
       ORDER BY c.relname
    `);
    return (rows as unknown as Array<{ relname: string }>).map((r) => r.relname);
  };

  const stamp = (offsetDays: number) => {
    const d = new Date(Date.now() + offsetDays * DAY);
    return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(
      d.getUTCDate()
    ).padStart(2, '0')}`;
  };

  beforeEach(async () => {
    await setSetting(SETTINGS_KEYS.MESSAGING_ROOM_RETENTION_DAYS, '14');
  });

  it('creates the days ahead that inserts will land in', async () => {
    await sweepRoomRetention();
    const names = await partitionsOf('room_messages');

    // Today, and every day up to the create-ahead horizon.
    expect(names).toContain(`room_messages_${stamp(0)}`);
    expect(names).toContain(`room_messages_${stamp(3)}`);
  });

  it('rolls the reactions in lockstep with the messages', async () => {
    // They are partitioned on the same day. Letting one lapse sends its
    // inserts to the DEFAULT partition, which retention never drops.
    await sweepRoomRetention();
    expect(await partitionsOf('room_message_reactions')).toContain(
      `room_message_reactions_${stamp(0)}`
    );
  });

  it('drops a partition whose whole range is past the cutoff', async () => {
    const old = `room_messages_${stamp(-40)}`;
    await db.execute(
      sql.raw(
        `CREATE TABLE IF NOT EXISTS "${old}" PARTITION OF room_messages ` +
          `FOR VALUES FROM ('${stamp(-40).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}') ` +
          `TO ('${stamp(-39).replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3')}')`
      )
    );
    expect(await partitionsOf('room_messages')).toContain(old);

    const dropped = await sweepRoomRetention();

    expect(dropped).toBeGreaterThanOrEqual(1);
    expect(await partitionsOf('room_messages')).not.toContain(old);
  });

  it('keeps one still inside retention', async () => {
    await sweepRoomRetention();
    const recent = `room_messages_${stamp(0)}`;
    await sweepRoomRetention();
    expect(await partitionsOf('room_messages')).toContain(recent);
  });

  it('is idempotent — a second pass drops nothing', async () => {
    await sweepRoomRetention();
    expect(await sweepRoomRetention()).toBe(0);
  });
});
