# Trackarr Helm chart

Deploys the whole stack on Kubernetes: the Nuxt SSR web front end, the Nitro
API, the Go tracker, and — optionally — Postgres and Valkey.

Sizing numbers quoted here are measured, not estimated. The workings are in
[`doc/guide/scaling.md`](../../../doc/guide/scaling.md); making the stateful
parts highly available is in
[`doc/guide/high-availability.md`](../../../doc/guide/high-availability.md).

## Requirements

- Kubernetes ≥ 1.27
- Helm ≥ 3.8
- An ingress controller, and a `StorageClass` for the uploads volume
- **The CloudNativePG operator**, when `postgresql.enabled` is true (below)
- Optional: cert-manager for TLS, the Prometheus Operator CRDs for the
  `ServiceMonitor`

### The CloudNativePG operator goes in once per cluster

The operator is cluster-scoped and owns CRDs, so it belongs to the cluster
rather than to a release:

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm install cnpg cnpg/cloudnative-pg -n cnpg-system --create-namespace
```

`postgresqlOperator.enabled=true` will install it as a subchart instead. That is
for throwaway and CI clusters only — two releases doing it in the same cluster
will fight over the CRDs.

## Install

```bash
helm dependency build deploy/helm/trackarr

helm upgrade --install trackarr deploy/helm/trackarr \
  -n trackarr --create-namespace \
  --set site.host=tracker.yourdomain.example
```

For a real deployment, start from the worked example and override the host:

```bash
helm upgrade --install trackarr deploy/helm/trackarr \
  -n trackarr --create-namespace \
  -f deploy/helm/trackarr/values-production.yaml \
  --set site.host=tracker.yourdomain.example
```

## Choosing what the chart brings with it

| Component | Off with | Then set |
| --- | --- | --- |
| Postgres | `postgresql.enabled=false` | `externalDatabase.url` (and `externalDatabase.migrationsUrl`), or `externalDatabase.existingSecret` |
| Valkey / Redis | `valkey.enabled=false` | `externalRedis.host`, optionally `externalRedis.existingSecret` |
| Web | `web.enabled=false` | — |
| API | `api.enabled=false` | — |
| Tracker | `tracker.enabled=false` | — |

Turning a dependency off without configuring its replacement fails at template
time with a message saying which value to set, rather than deploying something
that cannot connect.

### Why these dependencies, and not Bitnami's

Bitnami's 2025 catalogue change is the reason both of these are the projects'
own charts.

**Postgres — [CloudNativePG](https://cloudnative-pg.io/charts/).** The operator's
own `cluster` chart. Beyond being maintained by the project, it solves a problem
this stack actually has: `postgresql.poolers` creates an operator-managed
PgBouncer that follows the primary across a failover on its own, which is the
static `DB_HOST` problem the Compose file has.

**Valkey — [valkey-io/valkey-helm](https://valkey.io/valkey-helm/).** There is no
official Helm chart for Redis OSS: `helm.redis.io` publishes Redis Enterprise,
which is commercial. The Valkey project's chart exists precisely because of the
Bitnami change. Valkey is protocol-compatible — ioredis, go-redis and the
tracker's Lua scripts run against it unchanged — and the chart's lack of cluster
mode matches what
[`doc/guide/high-availability.md`](../../../doc/guide/high-availability.md)
recommends anyway: Sentinel-style replication rather than sharding, because Redis
was measured at 0.60 of a core while serving 4 811 announces/s.

To keep Redis proper, set `valkey.enabled=false` and point `externalRedis` at
your own.

## Secrets

Three values must be **stable across upgrades**, and this chart keeps them by
reading its own Secret back before generating anything:

| Key | Rotating it |
| --- | --- |
| `NUXT_SESSION_SECRET` | signs every member out |
| `IP_HASH_SECRET` | breaks IP-hash continuity, so the anti-cheat and ban history stop matching rows already written |
| `ADMIN_API_KEY` | breaks whatever calls the admin API |

`helm template` and `--dry-run` cannot read the cluster, so they show freshly
generated values. Nothing is applied, so nothing rotates.

### Bringing your own

```bash
kubectl -n trackarr create secret generic trackarr-secrets \
  --from-literal=NUXT_SESSION_SECRET="$(openssl rand -hex 32)" \
  --from-literal=ADMIN_API_KEY="$(openssl rand -hex 24)" \
  --from-literal=IP_HASH_SECRET="$(openssl rand -hex 32)"

helm upgrade --install trackarr deploy/helm/trackarr -n trackarr \
  --set secrets.create=false --set secrets.existingSecret=trackarr-secrets
```

`IP_HASH_SECRET` must be at least 32 characters — the tracker refuses to start
otherwise, and the chart checks it at template time rather than letting you find
out from a CrashLoopBackOff.

### Migrating an existing Compose deployment

Copy the three values out of your `.env` **before** the first install, or every
session and every IP hash changes:

```bash
helm upgrade --install trackarr deploy/helm/trackarr -n trackarr \
  --set secrets.sessionSecret="$NUXT_SESSION_SECRET" \
  --set secrets.adminApiKey="$ADMIN_API_KEY" \
  --set secrets.ipHashSecret="$IP_HASH_SECRET"
```

### Non-secret configuration

`config.existingConfigMap` replaces the generated ConfigMap wholesale. The chart
still builds `DATABASE_URL` and `REDIS_URL` itself, because those depend on
release-scoped service names. `config.extraEnv` is appended to all three
services, last, so it wins.

Third-party metadata keys (TMDB, IGDB, Google Books) go in
`config.metadataExistingSecret` in production — anything in `config.metadata`
ends up in a Secret this chart manages, which means it is also in your values
file.

## Read this before you open the site

Both the API and the tracker run with `TRUST_PROXY=true`, so they believe
`X-Forwarded-For`. **Your ingress controller must set that header from the real
peer address and must not forward one the client sent**, or a member can announce
as any IP they like — which defeats the IP-based anti-cheat and the ban list.

On ingress-nginx that means leaving `use-forwarded-headers` off in the controller
ConfigMap, which is the default.

The reference `docker/caddy/Caddyfile` additionally strips `CF-Connecting-IP` and
`True-Client-IP`. Nothing strips them for you here. Reproduce it — the annotation
is in `values-production.yaml`, commented in `values.yaml`, and needs
`allow-snippet-annotations: true` on the controller:

```yaml
nginx.ingress.kubernetes.io/configuration-snippet: |
  proxy_set_header CF-Connecting-IP "";
  proxy_set_header True-Client-IP "";
```

### Routing

Mirrors the Caddyfile exactly:

| Path | Backend |
| --- | --- |
| `/announce*` | tracker |
| `/api/*` | api |
| `/uploads/*` | api |
| everything else | web |

`/scrape` is **not** exposed, because the reference configuration does not expose
it either: it hands swarm counts for any info_hash to anyone who asks. Set
`ingress.exposeScrape=true` if you want it.

## Uploads need shared storage

There is no S3 client in the API — uploaded torrent files and images are written
to a filesystem path (`UPLOADS_DIR`). So every API replica has to write the same
volume, which means `ReadWriteMany` and a `StorageClass` that supports it (NFS,
CephFS, EFS, Azure Files).

With `ReadWriteOnce`, keep `api.replicaCount: 1`. The chart switches that
Deployment to the `Recreate` strategy when it detects the combination, because a
rolling update would otherwise deadlock waiting for a volume the old pod still
holds.

The claim carries `helm.sh/resource-policy: keep`: uploads are not reproducible,
so deleting the release leaves the data.

## UDP announces

Off by default. `tracker.udp.enabled=true` adds a UDP container port and a
separate `LoadBalancer` Service — separate because not every load-balancer
implementation will put UDP and TCP on one address.

Leave `externalTrafficPolicy: Local`. A UDP announce carries no
`X-Forwarded-For`, so the tracker reads the packet's source address; with
`Cluster`, kube-proxy rewrites it to a node address and every peer in the swarm
is handed the wrong IP.

## Probes

Readiness and liveness deliberately differ.

`/health` on the tracker and `/api/health` on the API both report on **Postgres
and Redis**. That is right for readiness — a replica that cannot reach either
should not be sent traffic — and wrong for liveness: a 30-second database
failover would have Kubernetes kill and restart every replica at once, which
lengthens the outage and produces a reconnect storm when the database returns. So
liveness is a socket check on both.

## Migrations

They run at API boot, and `api.runMigrations=true` is the default.
`scripts/migrate.mjs` takes `pg_advisory_lock(49192221)` first, so N replicas
serialise safely: the first migrates, the others block, then find the work done.
The API's startup probe allows 5 minutes for that.

`MIGRATIONS_DATABASE_URL` is pointed at the CloudNativePG `-rw` service, around
the pooler, on purpose: the lock is session-level and a session-level lock taken
on a transaction-pooled connection leaks to whoever borrows it next.

Set `api.runMigrations=false` to run them out of band. The chart then sets
`SKIP_DB_MIGRATIONS=true`.

## Metrics

The API exposes Prometheus metrics on a **dedicated port** (9090 by default), not
on the Nitro listener, and binds loopback unless told otherwise. `metrics.enabled`
opens it to `0.0.0.0` and generates a `METRICS_AUTH_TOKEN`;
`metrics.serviceMonitor.enabled` creates a `ServiceMonitor` that authenticates
with it.

The Go tracker exposes no metrics endpoint today, so only the API is scraped. The
Valkey subchart ships its own exporter under `valkey.metrics`, and CloudNativePG
has `postgresql.cluster.monitoring.enabled`.

## Uninstalling

```bash
kubectl -n trackarr get secret trackarr-secrets -o yaml > trackarr-secrets.backup.yaml
helm uninstall trackarr -n trackarr
```

What survives: the uploads PVC (`resource-policy: keep`), and whatever
CloudNativePG's own retention leaves. What does **not**: the generated Secret.
Take the copy first if you intend to recreate the release — without
`IP_HASH_SECRET` the ban and anti-cheat history no longer matches the rows in the
database.

## Validating a change to this chart

```bash
docker run --rm -v "$PWD/deploy/helm:/charts" --entrypoint sh alpine/helm -c \
  'cd /charts/trackarr && helm dependency build . && helm lint . && helm template tk . -n trackarr'
```

Schema-check the output too — `helm template` will happily render a manifest the
API server rejects:

```bash
docker run --rm -v "$PWD/deploy/helm:/charts" --entrypoint sh alpine/helm -c \
  'cd /charts/trackarr && helm template tk . -n trackarr' > /tmp/render.yaml
docker run --rm -v /tmp:/w ghcr.io/yannh/kubeconform \
  -summary -ignore-missing-schemas -kubernetes-version 1.30.0 /w/render.yaml
```

`-ignore-missing-schemas` is what skips the three CRDs (`Cluster`, `Pooler`,
`ServiceMonitor`); everything else is checked.

## Values

`helm show values deploy/helm/trackarr` is the reference — every key is commented
in place, with the measurement behind it where there is one. The highlights:

| Key | Default | Notes |
| --- | --- | --- |
| `site.host` | `tracker.example.com` | must be the name clients resolve; the announce URLs are derived from it |
| `global.imageTag` | `""` → `Chart.appVersion` | pin it |
| `api.uploads.accessMode` | `ReadWriteMany` | see above |
| `tracker.replicaCount` | `2` | for availability; one instance served 1 934 announces/s |
| `tracker.dbMaxConns` | `20` | per replica |
| `tracker.synchronousCommit` | `off` | the tracker's connections only, never the cluster |
| `postgresql.cluster.instances` | `2` | 3 gives CloudNativePG a quorum |
| `postgresql.cluster.postgresql.parameters` | tuned | `shared_buffers` is the highest-impact value measured |
| `valkey.valkeyConfig` | `maxmemory 1gb` | ~290 bytes per peer, measured; `peers:*` is not a cache |
