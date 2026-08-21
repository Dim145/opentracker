/**
 * Release-name parsing — re-exported from `@trackarr/shared`.
 *
 * The parser moved out of the web app because the API needs the same logic:
 * `torrents.season` / `torrents.episode` are filled at upload and backfilled
 * over the existing catalogue, and a second implementation would drift from
 * this one within a release. This file stays so Nuxt's `utils/` auto-import
 * keeps working for the upload, edit and listing pages.
 */
export {
  mergeParsedTags,
  parseNfoForTags,
  parseReleaseName,
  type ParsedRelease,
} from '@trackarr/shared/releaseParse';
