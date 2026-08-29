import { db, schema } from '@trackarr/db';
import { randomUUID } from 'crypto';
import { eq } from 'drizzle-orm';
import { requireAdminSession } from '~~/utils/adminAuth';
import { rateLimit, RATE_LIMITS } from '~~/utils/rateLimit';
import { validateBody, adminCategorySchema } from '~~/utils/schemas';

export default defineEventHandler(async (event) => {
  // Rate limit admin endpoints
  await rateLimit(event, RATE_LIMITS.admin);

  // Require admin authentication
  await requireAdminSession(event);

  // Validate request body with Zod
  const body = await validateBody(event, adminCategorySchema);

  const name = body.name.trim();
  const parentId = body.parentId || null;

  // Generate slug, prefixing with parent slug if subcategory
  let slug =
    body.slug ||
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');

  // If this is a subcategory, validate parent exists
  if (parentId) {
    const parent = await db.query.categories.findFirst({
      where: eq(schema.categories.id, parentId),
    });

    if (!parent) {
      throw createError({
        statusCode: 404,
        message: 'Parent category not found',
      });
    }

    // Prefix slug with parent slug for unique identification
    slug = `${parent.slug}-${slug}`;
  }

  try {
    const id = randomUUID();
    const [category] = await db
      .insert(schema.categories)
      .values({
        id,
        name,
        slug,
        parentId,
        newznabId: body.newznabId ?? null,
        isAdult: body.isAdult ?? false,
        type: body.type ?? null,
        icon: body.icon ?? null,
        createdAt: new Date(),
      })
      .returning();

  // The adult-category list is cached in process for a minute, so a
  // category flagged here would not actually be hidden until the TTL
  // rolled over — an operator marking a subtree adult and watching it
  // stay visible for the next sixty seconds, with nothing saying why.
  // The invalidator existed for exactly this and nothing called it.
  //
  // Per-process, so on a multi-replica deployment the others still wait
  // out the TTL. That is what the TTL is for; this removes the wait on
  // the replica the operator is actually looking at.
  invalidateAdultCategoryCache();
    return category;
  } catch (error: any) {
    if (error.code === '23505') {
      // Unique violation
      throw createError({
        statusCode: 409,
        message: 'Category already exists',
      });
    }
    throw error;
  }
});
