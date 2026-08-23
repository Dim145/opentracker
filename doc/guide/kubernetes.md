# Kubernetes

A Helm chart lives in the repository at
[`deploy/helm/trackarr`](https://github.com/Dim145/opentracker/tree/main/deploy/helm/trackarr).
It deploys web, api and tracker, and brings its own Postgres and cache or uses
yours.

This page is the overview and the decisions behind it. The chart's own
[README](https://github.com/Dim145/opentracker/blob/main/deploy/helm/trackarr/README.md)
is the reference — every value is commented in place, next to the measurement
that justifies it where there is one.

## Install

The CloudNativePG operator is cluster-scoped and owns CRDs, so it goes in once
per cluster rather than once per release:

```bash
helm repo add cnpg https://cloudnative-pg.github.io/charts
helm install cnpg cnpg/cloudnative-pg -n cnpg-system --create-namespace
```

Then the chart:

```bash
helm dependency build deploy/helm/trackarr

helm upgrade --install trackarr deploy/helm/trackarr \
  -n trackarr --create-namespace \
  -f deploy/helm/trackarr/values-production.yaml \
  --set site.host=tracker.yourdomain.example
```

## What it deploys

| | Replicas by default | Notes |
| --- | --- | --- |
| web (Nuxt SSR) | 2 | stateless |
| api (Nitro) | 2 | runs the boot migrations, serialised on an advisory lock |
| tracker (Go) | 2 | two for availability, not throughput — one instance served 1 934 announces/s in the battery |
| Postgres | CloudNativePG `Cluster`, 2 instances | plus an operator-managed PgBouncer `Pooler` |
| Cache | Valkey, 1 | protocol-compatible with Redis |

Postgres and the cache are optional. `postgresql.enabled=false` or
`valkey.enabled=false`, then point `externalDatabase` / `externalRedis` at your
own. Turning one off without configuring its replacement fails at template time
with a message naming the value to set.

## Why these dependency charts

Bitnami's 2025 catalogue change is why neither is Bitnami's.

**Postgres — [CloudNativePG](https://cloudnative-pg.io/charts/).** Beyond being
the project's own chart, it solves a problem this stack has: the `poolers` key
creates a PgBouncer the operator manages, and it follows the primary across a
failover by itself. That is exactly the static `DB_HOST` problem the Compose
file has, described in [High availability](./high-availability).

Transaction pooling is a requirement rather than a preference here: every
advisory lock on the request path is `pg_advisory_xact_lock`, released by
`COMMIT`. The migration runner is the exception — it takes a *session*-level
lock, so the chart points `MIGRATIONS_DATABASE_URL` around the pooler at the
`-rw` service.

**Cache — [the Valkey project's chart](https://valkey.io/valkey-helm/).** There
is no official Helm chart for Redis OSS: `helm.redis.io` publishes Redis
Enterprise, which is commercial. Valkey's exists precisely because of the
Bitnami change, and Valkey is protocol-compatible — ioredis, go-redis and the
tracker's Lua scripts run against it unchanged. Its lack of cluster mode matches
what [High availability](./high-availability) recommends anyway.

To keep Redis proper, disable the subchart and point `externalRedis` at your own.

## Three things that will bite

**Whatever is in front must set `X-Forwarded-For` itself.** `api.trustProxy` and
`tracker.trustProxy` default to on, so both believe that header — and that is
only safe when something upstream sets it from the real peer. If nothing does,
or the controller forwards one the client sent, a member can announce as any IP
they like, which defeats the IP-based anti-cheat and the ban list. On
ingress-nginx that means leaving `use-forwarded-headers` off, which is the
default. The reference `docker/caddy/Caddyfile` also strips `CF-Connecting-IP`
and `True-Client-IP`; nothing strips them for you here, and the annotation to
reproduce it ships commented in `values.yaml`.

**Uploads need `ReadWriteMany`.** There is no S3 client in the API — uploaded
torrent files and images go to a filesystem path — so every API replica writes
the same volume. With `ReadWriteOnce`, run a single replica; the chart switches
that Deployment to `Recreate` when it sees the combination, because a rolling
update would otherwise deadlock on a volume the old pod still holds.

**UDP needs `externalTrafficPolicy: Local`.** A UDP announce carries no
`X-Forwarded-For`, so the tracker reads the packet's source address. With
`Cluster`, kube-proxy rewrites it to a node address and every peer in the swarm
is handed the wrong IP.

## Without the chart's ingress

`ingress.enabled=false` omits the Ingress and changes nothing else, which covers
both an ingress that already exists and having none at all. The two need
different follow-up.

If **an ingress or proxy already exists** — or you route with a Gateway API
`HTTPRoute`, a mesh, or anything else this chart does not template — point it at
the three Services and reproduce the routing table above. `helm status` prints
their names and ports. Leave `trustProxy` on: your proxy is what sets the
header.

If **nothing sits in front** and the Services are exposed directly
(`LoadBalancer` or `NodePort`), set `api.trustProxy=false` and
`tracker.trustProxy=false`. Otherwise clients reach the pods with no proxy to
sanitise `X-Forwarded-For`, and the tracker will put a forged address into the
swarm. `tracker.service.port` exists for this case: BitTorrent clients announce
to whatever `NUXT_PUBLIC_TRACKER_HTTP_URL` says, so a directly exposed tracker
usually wants 80 rather than 8080.

The chart cannot tell the two apart, so `helm status` warns whenever a Service
is non-`ClusterIP` while `trustProxy` is still on.

## Secrets

Three generated values must survive every upgrade, so the chart reads its own
Secret back before generating anything and mints them only on a first install:

| Key | Rotating it |
| --- | --- |
| `NUXT_SESSION_SECRET` | signs every member out |
| `IP_HASH_SECRET` | breaks IP-hash continuity, so the anti-cheat and ban history stop matching rows already written |
| `ADMIN_API_KEY` | breaks whatever calls the admin API |

Migrating from Compose: copy those three out of your `.env` and pass them as
`secrets.sessionSecret` / `secrets.ipHashSecret` / `secrets.adminApiKey` on the
**first** install. Or bring a Secret of your own with `secrets.existingSecret`.

`IP_HASH_SECRET` is length-checked while templating — the tracker refuses to
start below 32 characters, and a template error beats a `CrashLoopBackOff`.

## Probes

Readiness and liveness deliberately differ. `/health` on the tracker and
`/api/health` on the API both report on **Postgres and Redis**, which is right
for readiness — a replica that cannot reach either should not be sent traffic —
and wrong for liveness: a 30-second database failover would have Kubernetes kill
and restart every replica at once, lengthening the outage and producing a
reconnect storm. Liveness is a socket check everywhere.

On a first install the tracker restarts a few times while CloudNativePG is
running `initdb`, because it exits when it cannot open Postgres. That is
Kubernetes backing off and retrying, and it resolves itself.

## Testing a change

The chart's README carries a full throwaway-cluster procedure: k3s in one
privileged container, helm and curl in containers, and a teardown that leaves
nothing behind — k3s keeps its images, etcd and provisioned volumes inside its
own container, so one `docker rm` removes the cluster.

Worth doing rather than trusting `helm template`: deploying the chart on a real
cluster is what caught a `global.imageRegistry` value leaking into the Valkey
subchart, probe timeouts on the SSR front end, and a CloudNativePG webhook
rejecting `min_wal_size` — none of which `helm lint`, thirteen `helm template`
combinations or `kubeconform` had flagged.

## Sizing

[Scaling out](./scaling) has the measurements, and the short version applies
here unchanged: an announce is floored at 30 ms on purpose, so tracker capacity
is set by concurrent requests rather than CPU, and Postgres costs 0.375 ms per
announce. Two tracker replicas are for surviving a node, not for throughput.
