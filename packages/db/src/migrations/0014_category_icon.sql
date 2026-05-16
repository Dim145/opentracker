-- Optional Phosphor icon glyph per category. When set, the frontend
-- uses it in place of the type-derived default (movie → film-strip,
-- tv → television, …) so an operator can pick a more specific icon
-- per category from the admin form. Null on every existing row;
-- the frontend's `getCategoryIcon` helper falls back to the type
-- mapping and finally to a generic file glyph when both are unset.
ALTER TABLE "categories" ADD COLUMN "icon" text;
