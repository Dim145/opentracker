# Trackarr Helm chart

Deploys the whole stack on Kubernetes: the Nuxt SSR web front end, the Nitro
API, the Go tracker, and — optionally — Postgres, Valkey and an S3-compatible
object store for uploads.

Sizing numbers quoted here are measured, not estimated. The workings are in
[`doc/guide/scaling.md`](../../../doc/guide/scaling.md); making the stateful
parts highly available is in
[`doc/guide/high-availability.md`](../../../doc/guide/high-availability.md).

## Requirements

- Kubernetes ≥ 1.27
- Helm ≥ 3.8
- An ingress controller, and a `StorageClass` for the uploads volume —
  `ReadWriteMany` if you keep `storage.driver: fs` and run more than one API
  replica, or none at all with `storage.driver: s3`
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
| Object store | `rustfs.enabled=false` (the default) | nothing, unless `storage.driver=s3` — then `storage.s3.endpoint` and credentials for the external store. With `rustfs.enabled=true` the credentials are generated |
| Ingress | `ingress.enabled=false` | see below — nothing else is required, but check `trustProxy` |
| Web | `web.enabled=false` | — |
| API | `api.enabled=false` | — |
| Tracker | `tracker.enabled=false` | — |

Turning a dependency off without configuring its replacement fails at template
time with a message saying which value to set, rather than deploying something
that cannot connect.

### Why these dependencies, and not Bitnami's

Bitnami's 2025 catalogue change is the reason these are the projects' own
charts.

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

**Object store — [RustFS](https://charts.rustfs.com).** The RustFS project's own
chart, and off by default: it does nothing unless `storage.driver: s3`. It is
here so that "run more than one API replica" does not require finding a
`ReadWriteMany` StorageClass first — see [Uploads](#uploads) below. Any other
S3-compatible store works just as well; point `storage.s3.endpoint` at it and
leave `rustfs.enabled` false.

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

> **⚠️ Sous ArgoCD, Flux en mode `helm template`, ou tout
> `helm template | kubectl apply`, la phrase ci-dessus ne tient pas.**
>
> La stabilité repose sur `lookup`, qui lit l'état du cluster. ArgoCD rend le
> chart avec `helm template` **puis applique la sortie** : `lookup` y est
> toujours vide, donc chaque synchronisation génère de nouvelles valeurs et les
> applique. Un `git push` déconnecte alors tout le monde
> (`NUXT_SESSION_SECRET`), casse la continuité des empreintes d'IP
> (`IP_HASH_SECRET`) et invalide `ADMIN_API_KEY` — les trois conséquences que
> le tableau ci-dessus décrit comme inacceptables.
>
> Sur ces pipelines, il faut **épingler les secrets** plutôt que les laisser
> générer : `secrets.existingSecret` en désignant un `Secret` géré hors du
> chart, ou les trois valeurs fixées dans les `values`.
>
> Le `Secret` rendu ne porte volontairement pas `helm.sh/resource-policy: keep`
> — `templates/secret.yaml` explique pourquoi : le garder à la désinstallation
> laisserait un `Secret` que plus rien ne possède. L'épinglage est donc la seule
> réponse ici, pas une annotation.

### Object-store credentials are generated too

With `rustfs.enabled: true` there is nothing to supply. The chart mints an
access key and a secret key on the first install and keeps them stable
afterwards by reading its own Secret back — rotating them would leave the API
presenting keys the store no longer accepts, or the reverse, depending on which
pod restarted first.

Helm cannot hand a generated value to a subchart's *values*, which is what made
this look impossible. It can hand it a Secret **name**:
`rustfs.secret.existingSecret` names the Secret this chart creates, the subchart
resolves it at runtime, and that Secret carries both formats — `S3_ACCESS_KEY_ID`
/ `S3_SECRET_ACCESS_KEY` for the API, `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY`
for the server. One render writes both, so they cannot drift.

Because that value reaches the subchart unrendered it has to be a literal, so
the default Secret name is not release-scoped. Two releases in one namespace:
override `rustfs.secret.existingSecret` on the second and the parent follows it.

An **external** store is different — the chart will not invent credentials it
cannot also configure on the far end. Supply `storage.s3.accessKeyId` and
`storage.s3.secretAccessKey`, or `storage.s3.existingSecret` naming a Secret
with `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. Rendering fails if neither is
given.

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

`api.trustProxy` and `tracker.trustProxy` default to **on**, so both believe
`X-Forwarded-For`. That is only safe when something in front SETS that header
from the real peer address. **If nothing does — or if it forwards one the client
sent — a member can announce as any IP they like**, which defeats the IP-based
anti-cheat, the ban list and the rate limits. The tracker case is the worse one:
the announcing address is what enters the swarm.

On ingress-nginx that means leaving `use-forwarded-headers` off in the controller
ConfigMap, which is the default.

Note the application itself defaults both flags to `false`. The chart defaults
them to `true` because its own ingress is on by default — so turning the ingress
off is exactly when you have to revisit them.

`trustCfConnectingIp` is separate and stays off unless you are genuinely behind
Cloudflare with ingress locked to its published ranges. On any other edge
`CF-Connecting-IP` is client-supplied, which is why the reference Caddy
configuration strips it.

## Running without the chart's ingress

`ingress.enabled=false` omits the Ingress and changes nothing else. It covers two
situations that need different follow-up.

**An ingress or proxy already exists**, or you route with something this chart
does not template — a Gateway API `HTTPRoute`, a service mesh, an external
proxy. Point it at the three Services and reproduce the routing table below;
`helm status` prints the names and ports. Leave `trustProxy` on, because your
proxy is the thing setting the header.

**Nothing sits in front and the Services are exposed directly**
(`type: LoadBalancer` or `NodePort`). Then:

```bash
helm upgrade --install trackarr deploy/helm/trackarr -n trackarr \
  --set ingress.enabled=false \
  --set tracker.service.type=LoadBalancer --set tracker.service.port=80 \
  --set api.trustProxy=false --set tracker.trustProxy=false
```

`tracker.service.port` exists for this: BitTorrent clients announce to whatever
`NUXT_PUBLIC_TRACKER_HTTP_URL` says, so a directly exposed tracker usually wants
80 rather than 8080. It moves the Service port and `TRACKER_INTERNAL_URL`
together, not the container port.

The chart cannot tell which of the two situations you are in, so `helm status`
warns whenever a Service is non-`ClusterIP` while `trustProxy` is still on. If a
cloud load balancer or CDN in the path does rewrite the header, that warning is
a false positive — ignore it deliberately rather than by accident.

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

## Uploads

Two backends, chosen with `storage.driver`. The default is `fs`, so an existing
release upgrades with no change in behaviour.

### `storage.driver: fs` (default)

Uploaded images and torrent files are written to a filesystem path
(`api.uploads.mountPath`, exported as `UPLOADS_DIR`). Every API replica has to
write the same volume, which means `ReadWriteMany` and a `StorageClass` that
supports it — NFS, CephFS, EFS, Azure Files.

With `ReadWriteOnce`, keep `api.replicaCount: 1`. The chart switches that
Deployment to the `Recreate` strategy when it detects the combination, because a
rolling update would otherwise deadlock waiting for a volume the old pod still
holds.

The claim carries `helm.sh/resource-policy: keep`: uploads are not reproducible,
so deleting the release leaves the data.

One thing to check on an RWX class: the pod runs as uid 1001 with
`fsGroup: 1001`, and it is the fsGroup that makes the volume writable — the
kubelet chowns it to `root:1001` and adds `g+rwx`. Several NFS and CIFS
provisioners ignore fsGroup, and those are precisely the ReadWriteMany classes
this needs. Verified against the real image: `root:1001` mode 2775 writes,
`root:root` mode 0755 fails with `EACCES`. If the first branding upload returns
500, that is where to look.

### `storage.driver: s3`

The API talks to an S3-compatible object store instead, and no uploads volume is
created at all — `api.replicaCount` becomes as free as the web tier's. This is
the only blocker `doc/guide/scaling.md` lists against scaling the API out, and
this is how you remove it.

Reads still go **through** the API rather than by presigned redirect. That is
deliberate, and the reasoning is in `apps/api/utils/storage/s3Driver.ts`: an
in-cluster store has no name a browser can resolve, and the `nosniff` +
SVG-sandbox response headers on `/uploads/*` are a security control that a
redirect would hand over to the object store.

**With the bundled RustFS.** Nothing else to install. Write the credentials down
once, under `rustfs`, and the API reads the same pair:

```bash
helm upgrade --install trackarr deploy/helm/trackarr \
  -n trackarr --create-namespace \
  --set site.host=tracker.yourdomain.example \
  --set storage.driver=s3 \
  --set rustfs.enabled=true
```

The chart defaults RustFS to **standalone**: one pod, one PVC, no erasure
coding, no ingress. That suits a tracker's branding assets and torrent files,
and it keeps the footprint honest — but it does mean the object store is then
the one part of the deployment with no redundancy. Back the PVC up, or set
`rustfs.mode.distributed.enabled=true` with `rustfs.replicaCount: 4`.

Unlike `NUXT_SESSION_SECRET` and friends, these credentials cannot be generated
for you: Helm has no way to pass a value it generated into a subchart's values,
and RustFS needs the same pair the API uses. Keep them with your other release
values.

**With a store you already run.** Leave `rustfs.enabled` false:

```yaml
storage:
  driver: s3
  s3:
    endpoint: https://s3.eu-west-3.amazonaws.com
    region: eu-west-3
    bucket: trackarr-uploads
    forcePathStyle: false      # true for MinIO, Ceph RGW, RustFS
    createBucket: false        # the bucket already exists
    existingSecret: trackarr-s3   # keys: S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY
```

**Migrating an existing release.** Nothing copies the old files for you. Sync
the PVC's contents into the bucket first, then flip the driver — the object keys
are the filenames, with `storage.s3.prefix` in front if you set one:

```bash
kubectl -n trackarr exec deploy/trackarr-api -- tar -C /app/data/uploads -cf - . \
  | tar -C ./uploads-backup -xf -
aws s3 sync ./uploads-backup s3://trackarr-uploads/
```

Leave `api.uploads.enabled: true` while you do it: the PVC keeps its
`resource-policy: keep` annotation and survives the switch, so you can go back.

## UDP announces

Off by default. `tracker.udp.enabled=true` adds a UDP container port and a
separate `LoadBalancer` Service — separate because not every load-balancer
implementation will put UDP and TCP on one address.

Leave `externalTrafficPolicy: Local`. A UDP announce carries no
`X-Forwarded-For`, so the tracker reads the packet's source address; with
`Cluster`, kube-proxy rewrites it to a node address and every peer in the swarm
is handed the wrong IP.

The same applies to `/announce` over **HTTP**, on the ingress controller's own
Service — which this chart does not own. ingress-nginx sets `X-Forwarded-For`
from `$remote_addr`, and with the controller Service's default
`externalTrafficPolicy: Cluster` kube-proxy has already replaced that with a
node address. Every peer then registers under one of a handful of node IPs:
swarms fail to connect, IP bans ban the cluster, and rate limiting shares a
bucket across all members. Set `controller.service.externalTrafficPolicy: Local`
in the ingress-nginx values, or `use-proxy-protocol` behind an L4 load
balancer.

## Probes

Readiness and liveness deliberately differ.

`/health` on the tracker and `/api/health` on the API both report on **Postgres
and Redis**. That is right for readiness — a replica that cannot reach either
should not be sent traffic — and wrong for liveness: a 30-second database
failover would have Kubernetes kill and restart every replica at once, which
lengthens the outage and produces a reconnect storm when the database returns. So
liveness is a socket check on both.

## The tracker restarts a few times on a first install

Expected, and self-resolving. `cmd/tracker/main.go` exits if it cannot open
Postgres, so while CloudNativePG is still running `initdb` the tracker container
exits and Kubernetes backs off and retries. On a test cluster that was three
restarts over about 45 seconds, after which it connected and stayed up. The API
does the same, then blocks on the migration lock.

Nothing is added here to paper over it: an initContainer polling the pooler would
mean another image to pull and another thing to keep current, to replace a
back-off that already works.

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

## Upgrading from a release older than the uid alignment

The pods used to run as uid 1001 while all three images are built for 65532 —
`gcr.io/distroless/nodejs24-debian13:nonroot` for the api and web, an explicit
`USER 65532:65532` for the tracker. It worked only because the bundles are
world-readable. The chart now runs them as the uid they were built for.

If you use `storage.driver: fs`, that means `fsGroup` changes from 1001 to
65532, so the first restart has the kubelet re-chown the uploads volume's group.
Nothing is lost — the files are reached through the group either way, and this
was measured on a cluster: a volume written under 1001 is still served after the
upgrade, and new uploads succeed. `fsGroupChangePolicy: OnRootMismatch` keeps
that walk to the one time it is needed rather than every pod start, which is
what otherwise makes a large volume slow to mount.

Two cases to know about:

- **A StorageClass that ignores `fsGroup`** (several NFS and CIFS provisioners
  do) never applied 1001 either, so nothing changes — it was already broken, and
  [Troubleshooting](../../../doc/guide/troubleshooting.md) has the diagnosis.
- **`storage.driver: s3`** has no volume at all, so there is nothing to
  re-chown.

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

## Testing a change in a throwaway cluster

Everything below runs in containers — no cluster tooling on your machine, and a
single `docker rm` at the end removes the lot, because k3s keeps its images,
etcd and provisioned volumes inside its own container.

```bash
docker network create helmtest
docker run -d --name k3s-test --privileged --network helmtest --network-alias k3s \
  --tmpfs /run --tmpfs /var/run \
  rancher/k3s:v1.30.6-k3s1 server \
    --disable traefik --disable metrics-server --tls-san k3s --write-kubeconfig-mode 644

# Wait for the node, then take the kubeconfig and repoint it at the network alias
until docker exec k3s-test kubectl get nodes 2>/dev/null | grep -q " Ready"; do sleep 5; done
mkdir -p /tmp/k8s && docker cp k3s-test:/etc/rancher/k3s/k3s.yaml /tmp/k8s/kubeconfig
sed -i '' 's#https://127.0.0.1:6443#https://k3s:6443#' /tmp/k8s/kubeconfig
```

A `helm` that can reach it:

```bash
helmc() {
  docker run --rm --network helmtest \
    -v /tmp/k8s:/kube -v "$PWD/deploy/helm:/charts" \
    -e KUBECONFIG=/kube/kubeconfig -e HELM_CACHE_HOME=/kube/.cache \
    -e HELM_CONFIG_HOME=/kube/.config -e HELM_DATA_HOME=/kube/.data \
    --entrypoint helm alpine/helm:latest "$@"
}
```

Then the operator, an ingress controller, and the chart. `local-path` — k3s's
provisioner — does not do ReadWriteMany, so the uploads volume has to be RWO for
this, which conveniently exercises the `Recreate` branch:

```bash
helmc repo add cnpg https://cloudnative-pg.github.io/charts
helmc repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helmc repo update
helmc install cnpg cnpg/cloudnative-pg -n cnpg-system --create-namespace --wait
helmc install ingress-nginx ingress-nginx/ingress-nginx -n ingress-nginx \
  --create-namespace --set controller.service.type=LoadBalancer

helmc dependency build /charts/trackarr
helmc install trackarr /charts/trackarr -n trackarr --create-namespace \
  --set site.host=tracker.test.local --set ingress.className=nginx \
  --set ingress.tls.enabled=false --set image.tag=0.29.0 \
  --set web.replicaCount=1 --set api.replicaCount=1 --set tracker.replicaCount=1 \
  --set api.uploads.accessMode=ReadWriteOnce --set api.uploads.size=1Gi \
  --set postgresql.cluster.instances=1 \
  --set postgresql.cluster.storage.size=2Gi \
  --set postgresql.cluster.walStorage.size=1Gi \
  --set postgresql.cluster.postgresql.parameters.shared_buffers=128MB \
  --set postgresql.cluster.postgresql.parameters.max_wal_size=512MB \
  --set postgresql.cluster.postgresql.parameters.min_wal_size=80MB
```

That last pair matters: CloudNativePG's webhook rejects `min_wal_size` greater
than or equal to `max_wal_size`, so lowering one means lowering the other.

`local-path`'s lack of ReadWriteMany is exactly what `storage.driver=s3` is for,
so the same cluster is a good place to exercise the other branch — swap the two
`api.uploads.*` lines for:

```bash
  --set storage.driver=s3 --set rustfs.enabled=true \
  --set rustfs.storageclass.dataStorageSize=1Gi \
```

Then upload a logo in the admin UI and fetch it back through `/uploads/...`; a
200 with the right `Content-Type` means the whole path worked, since the API is
the only thing that ever talks to the bucket.

Prove the routing, which is the part `helm template` cannot check. klipper-lb
gives the ingress controller the k3s container's address on `helmtest`:

```bash
LB=$(docker exec k3s-test kubectl get svc -n ingress-nginx ingress-nginx-controller \
       -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
curl() { docker run --rm --network helmtest curlimages/curl:latest -s \
           -H "Host: tracker.test.local" "$@"; }

curl "http://$LB/api/health"     # {"status":"healthy", ...}          -> api
curl "http://$LB/announce"       # d14:failure reason15:Invalid passkeye -> tracker
curl -o /dev/null -w '%{http_code}\n' "http://$LB/"   # 302 to /auth/login -> web
```

The bencoded `Invalid passkey` is the useful one: it means the request reached
the Go tracker *and* the tracker reached Postgres through the pooler to look the
passkey up.

Teardown, leaving nothing:

```bash
docker rm -f k3s-test
docker network rm helmtest
rm -rf /tmp/k8s
```

The k3s image declares `VOLUME`s, so it leaves a few anonymous volumes behind.
Resist `docker volume ls -qf dangling=true | xargs -r docker volume rm` to clear
them: "dangling" only means *no container currently references it*, so that list
includes every stopped project's database. On the machine this walkthrough was
last run, it would have taken out the e2e Postgres and Redis volumes and two
unrelated projects' data. Snapshot first and remove only the difference:

```bash
docker volume ls -q | sort > /tmp/vols-before   # BEFORE creating the cluster
```

```bash
comm -13 /tmp/vols-before <(docker volume ls -q | sort) | xargs -r docker volume rm
```

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

Neither of those catches the class of bug that actually bites, though: a render
that is valid YAML, passes the schema, and still cannot run. `check-render.sh`
asserts the shape instead —

```bash
sh deploy/helm/trackarr/check-render.sh
```

Its main assertion is that every `secretKeyRef` in the render names a Secret the
chart also creates, or one the operator was explicitly asked to supply. That is
what had been missing: with `valkey.enabled: false` and `externalRedis.password`
set, two containers pointed at `{release}-valkey-auth` while `valkey-auth.yaml`
was gated on `valkey.enabled`, so nothing created it and every pod came up
`CreateContainerConfigError`. `helm lint`, `helm template` and kubeconform were
all green on that release. The rest of the file covers the storage driver's
wiring and the combinations that must fail at render time rather than install.

## Values

`helm show values deploy/helm/trackarr` is the reference — every key is commented
in place, with the measurement behind it where there is one. The highlights:

| Key | Default | Notes |
| --- | --- | --- |
| `site.host` | `tracker.example.com` | must be the name clients resolve; the announce URLs are derived from it |
| `global.imageTag` | `""` → `Chart.appVersion` | pin it |
| `storage.driver` | `fs` | `s3` drops the uploads volume entirely; see [Uploads](#uploads) |
| `storage.s3.forcePathStyle` | `true` | right for RustFS/MinIO/Ceph, wrong for AWS |
| `rustfs.enabled` | `false` | an in-cluster object store for `storage.driver=s3` |
| `api.uploads.accessMode` | `ReadWriteMany` | `storage.driver=fs` only; see above |
| `tracker.replicaCount` | `2` | for availability; one instance served 1 934 announces/s |
| `tracker.dbMaxConns` | `20` | per replica |
| `tracker.synchronousCommit` | `off` | the tracker's connections only, never the cluster |
| `postgresql.cluster.instances` | `2` | 3 gives CloudNativePG a quorum |
| `postgresql.cluster.postgresql.parameters` | tuned | `shared_buffers` is the highest-impact value measured |
| `valkey.valkeyConfig` | `maxmemory 1gb` | ~290 bytes per peer, measured; `peers:*` is not a cache |
