/**
 * POST /api/admin/templates
 *
 * Add a template to the site catalogue: every member sees it in the listing
 * generator and can duplicate it, exactly like the built-in default layout
 * except that this one is a row an operator controls.
 *
 * No quota. The quota bounds what a *member* can accumulate; the catalogue is
 * curated by the people who set the quota in the first place.
 *
 * `ownerId` is left NULL and `createdBy` records who added it. That pair is
 * the whole point of the site/private split: the template belongs to the site
 * and outlives its author's account, while the name of whoever put it there
 * survives as long as their account does.
 */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, schema } from '@trackarr/db';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { requireAdminSession } from '~~/utils/adminAuth';
import { assertTemplateGrammar } from '~~/utils/templateGrammar';

const bodySchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(500).optional().nullable(),
  category: z.enum(['universal', 'video']).default('universal'),
  // Same caps as the member route, deliberately: a site template is read by
  // more people, not by different code, and a catalogue entry that renders
  // differently from a member's copy of it would be a trap.
  content: z
    .string()
    .min(1)
    .max(15000)
    .refine((v) => v.trim().length > 0, {
      message: 'Template content cannot be blank',
    }),
});

export default defineEventHandler(async (event) => {
  const { user } = await requireAdminSession(event);
  await rateLimit(event, RATE_LIMITS.admin);
  const body = await readValidatedBody(event, bodySchema.parse);
  assertTemplateGrammar(body.content);

  const id = randomUUID();
  await db.insert(schema.presentationTemplates).values({
    id,
    // NULL owner, `site` visibility, never a personal default: the three
    // together are what the CHECK constraint permits, and writing them
    // explicitly here keeps the shape readable rather than relying on column
    // defaults.
    ownerId: null,
    createdBy: user.id,
    name: body.name,
    description: body.description || null,
    category: body.category,
    content: body.content,
    visibility: 'site',
    isDefault: false,
  });

  return { id };
});
