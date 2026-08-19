/**
 * GET /api/docs/openapi.json
 *
 * Spécification OpenAPI de l'API, régénérée à chaque build depuis
 * l'arborescence des routes. Publique : elle ne décrit que la surface, jamais
 * de donnée, et un client qui doit s'intégrer en a besoin avant même d'avoir
 * un compte. Les exigences d'authentification y figurent par opération, sous
 * `x-auth` et dans `security`.
 */
import spec from '../../../openapi.json';

export default defineEventHandler((event) => {
  setHeader(event, 'content-type', 'application/json; charset=utf-8');
  // La spec ne change qu'au déploiement : un cache court épargne au client de
  // la retélécharger à chaque ouverture de la documentation.
  setHeader(event, 'cache-control', 'public, max-age=300');
  return spec;
});
