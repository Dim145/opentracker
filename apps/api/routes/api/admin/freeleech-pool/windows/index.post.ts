/**
 * POST /api/admin/freeleech-pool/windows — create a window.
 *
 * Four flavours via the `kind` discriminator:
 *
 *   - `oneoff`   dated [startsAt, endsAt) range
 *   - `weekly`   weekday + minute-of-day bounds (UTC), repeats weekly
 *   - `monthly`  list of days-of-month + minute-of-day bounds (UTC)
 *   - `yearly`   month/day for both ends, whole-day, repeats annually
 *
 * Each kind ships its own zod schema so the admin form can submit a
 * focused payload without padding null fields for unrelated kinds.
 */
import { randomUUID } from 'node:crypto';
import { db, schema } from '@trackarr/db';
import { z } from 'zod';
import { requireAdminSession } from '~~/utils/adminAuth';
import { validateBody } from '~~/utils/schemas';

const oneoffSchema = z
  .object({
    kind: z.literal('oneoff'),
    startsAt: z.string().datetime(),
    endsAt: z.string().datetime(),
    label: z.string().max(60).nullish(),
  })
  .refine((b) => new Date(b.endsAt) > new Date(b.startsAt), {
    message: 'endsAt must be after startsAt',
  });

const weeklySchema = z
  .object({
    kind: z.literal('weekly'),
    weekdayStart: z.number().int().min(0).max(6),
    minuteStart: z.number().int().min(0).max(1440),
    weekdayEnd: z.number().int().min(0).max(6),
    minuteEnd: z.number().int().min(0).max(1440),
    label: z.string().max(60).nullish(),
  })
  .refine(
    (b) =>
      b.weekdayStart !== b.weekdayEnd || b.minuteStart !== b.minuteEnd,
    {
      message: 'Weekly window must be non-empty',
    }
  );

const monthlySchema = z
  .object({
    kind: z.literal('monthly'),
    // At least one day; refuse empty lists at the boundary so we
    // don't store a row that will never match.
    monthlyDays: z.array(z.number().int().min(1).max(31)).min(1).max(31),
    minuteStart: z.number().int().min(0).max(1440),
    minuteEnd: z.number().int().min(0).max(1440),
    label: z.string().max(60).nullish(),
  })
  .refine((b) => b.minuteStart !== b.minuteEnd, {
    message: 'Time-of-day window must be non-empty',
  });

const yearlySchema = z
  .object({
    kind: z.literal('yearly'),
    yearMonthStart: z.number().int().min(1).max(12),
    yearDayStart: z.number().int().min(1).max(31),
    yearMonthEnd: z.number().int().min(1).max(12),
    yearDayEnd: z.number().int().min(1).max(31),
    label: z.string().max(60).nullish(),
  });

const bodySchema = z.discriminatedUnion('kind', [
  oneoffSchema,
  weeklySchema,
  monthlySchema,
  yearlySchema,
]);

export default defineEventHandler(async (event) => {
  await requireAdminSession(event);
  const body = await validateBody(event, bodySchema);

  const id = randomUUID();
  const insertValues: typeof schema.freeleechPoolWindows.$inferInsert = {
    id,
    kind: body.kind,
    enabled: true,
    label: body.label ?? null,
  };
  if (body.kind === 'oneoff') {
    insertValues.startsAt = new Date(body.startsAt);
    insertValues.endsAt = new Date(body.endsAt);
  } else if (body.kind === 'weekly') {
    insertValues.weekdayStart = body.weekdayStart;
    insertValues.weekdayEnd = body.weekdayEnd;
    insertValues.minuteStart = body.minuteStart;
    insertValues.minuteEnd = body.minuteEnd;
  } else if (body.kind === 'monthly') {
    // De-dupe + sort the days so two rows with the same intent
    // can't differ by ordering.
    insertValues.monthlyDays = Array.from(new Set(body.monthlyDays)).sort(
      (a, b) => a - b
    );
    insertValues.minuteStart = body.minuteStart;
    insertValues.minuteEnd = body.minuteEnd;
  } else if (body.kind === 'yearly') {
    insertValues.yearMonthStart = body.yearMonthStart;
    insertValues.yearDayStart = body.yearDayStart;
    insertValues.yearMonthEnd = body.yearMonthEnd;
    insertValues.yearDayEnd = body.yearDayEnd;
  }
  const [inserted] = await db
    .insert(schema.freeleechPoolWindows)
    .values(insertValues)
    .returning();
  return { window: inserted };
});
