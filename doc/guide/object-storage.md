# Object storage for uploads

Uploaded files — branding images today, anything the upload routes write
tomorrow — go to one of two backends, chosen by `STORAGE_DRIVER`:

| `STORAGE_DRIVER` | Where files go | What it costs you |
| --- | --- | --- |
| `fs` *(default)* | a directory, `UPLOADS_DIR` | every API replica must write the *same* directory |
| `s3` | an S3-compatible bucket | an object store to run, or a bill |

The default is `fs`, and nothing about an existing deployment changes until you
set the variable. This page is about why you might, and what to check when you
do.

## Why the second backend exists

With `fs`, the API is the one service in the stack that cannot simply be
scaled by raising a replica count. A logo written by replica A is missing on
replica B, so a page renders a broken image depending on which replica answered.
The fix is shared storage, and shared storage is where it gets awkward:

- **Compose** needs a volume both containers see, which in practice means one
  host, or NFS wired in by hand.
- **Kubernetes** needs a `ReadWriteMany` PersistentVolumeClaim. That rules out
  most default `StorageClass`es — k3s's `local-path`, AWS EBS, GCE PD, Azure
  Disk are all ReadWriteOnce — and leaves you standing up NFS, CephFS, EFS or
  Azure Files for a handful of PNG files.

[Scaling out](./scaling) lists shared storage as the API's only blocker to
horizontal scaling. `STORAGE_DRIVER=s3` is how you remove it.

It is not the right answer for everyone. A single-host tracker with one API
replica has nothing to gain and one more service to keep alive; `fs` is a
directory, and a directory does not have credentials, a network path or a
bucket policy. Switch when replicas are the reason, not because object storage
sounds tidier.

## Configuration

```bash
STORAGE_DRIVER=s3
S3_ENDPOINT=https://s3.eu-west-3.amazonaws.com
S3_REGION=eu-west-3
S3_BUCKET=trackarr-uploads
S3_ACCESS_KEY_ID=…
S3_SECRET_ACCESS_KEY=…
S3_FORCE_PATH_STYLE=false      # true for MinIO / RustFS / Ceph RGW
```

The full list, with defaults, is in
[Environment variables](../reference/env#object-storage-uploads).

Two of them are worth stopping on.

**`S3_FORCE_PATH_STYLE`** decides between `endpoint/bucket/key` (path-style) and
`bucket.endpoint/key` (virtual-hosted). It defaults to `true`, because the
self-hosted stores people put behind this — MinIO, RustFS, Ceph RGW, Garage —
generally have no wildcard DNS and only answer path-style. AWS wants `false`;
the API logs a warning if the endpoint looks like AWS and this is still on.

**`S3_CREATE_BUCKET`** (default `false`) makes the API create the bucket on its
first write if it gets a `NoSuchBucket`. Useful for a store you just installed
alongside the tracker, wrong for AWS, where the credentials should not have
`s3:CreateBucket` in the first place.

### Credentials and Docker secrets

`S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` go through the same `readSecret()`
path as every other secret in the API, so the `*_FILE` form works:

```yaml
environment:
  S3_ACCESS_KEY_ID_FILE: /run/secrets/s3_access_key
  S3_SECRET_ACCESS_KEY_FILE: /run/secrets/s3_secret_key
```

`S3_SESSION_TOKEN` is read the same way, for temporary STS credentials.

### What the credentials need to be allowed to do

`GetObject`, `PutObject` and `DeleteObject` on the bucket, plus `CreateBucket`
only if `S3_CREATE_BUCKET=true`. Nothing lists, nothing reads bucket policy,
nothing touches versioning. A policy scoped to `arn:aws:s3:::bucket/*` is
enough — add `arn:aws:s3:::bucket` itself only for bucket creation.

## Kubernetes

The Helm chart has a `storage:` block and ships RustFS as an optional subchart,
so you do not have to find an object store before you can use one:

```bash
helm upgrade --install trackarr deploy/helm/trackarr \
  -n trackarr --create-namespace \
  --set site.host=tracker.example.com \
  --set storage.driver=s3 \
  --set rustfs.enabled=true \
  --set rustfs.secret.rustfs.access_key="$(openssl rand -hex 12)" \
  --set rustfs.secret.rustfs.secret_key="$(openssl rand -hex 32)"
```

With `storage.driver: s3` the chart creates no uploads PVC and mounts no
volume, so `api.replicaCount` becomes as unconstrained as the web tier's.

The endpoint is derived from the RustFS Service, and the credentials are read
from `rustfs.secret.rustfs.*` — set once, used by both. They are the one
credential in the chart you have to write down yourself: Helm cannot hand a
value it generated into a subchart's values, and the object store and its
client must agree.

RustFS defaults to **standalone** here — one pod, one PVC, no erasure coding, no
ingress — which suits branding assets and keeps the footprint small, but does
make the object store the piece of the deployment with no redundancy. Back the
PVC up, or switch to distributed mode
(`rustfs.mode.distributed.enabled=true`, `rustfs.replicaCount=4`).

The chart's own README has the details, including pointing at a store you
already run: [`deploy/helm/trackarr/README.md`](https://github.com/Dim145/opentracker/blob/main/deploy/helm/trackarr/README.md).

## Migrating an existing deployment

Nothing copies the files for you, and the switch is not automatic. Copy first,
then flip the variable — object keys are exactly the filenames, with
`S3_PREFIX` in front if you set one.

Compose:

```bash
docker compose -f docker-compose.prod.yml cp api:/app/data/uploads ./uploads-backup
aws s3 sync ./uploads-backup s3://trackarr-uploads/ --endpoint-url "$S3_ENDPOINT"
```

Kubernetes:

```bash
kubectl -n trackarr exec deploy/trackarr-api -- tar -C /app/data/uploads -cf - . \
  | tar -C ./uploads-backup -xf -
aws s3 sync ./uploads-backup s3://trackarr-uploads/
```

Then set `STORAGE_DRIVER=s3` and restart. Keep the old volume around until you
have loaded a few `/uploads/...` URLs: the chart's PVC carries
`helm.sh/resource-policy: keep`, and the Compose volume is not removed by a
`down` without `-v`, so going back is a variable away.

The database stores relative URLs (`/uploads/logo-ab12cd34.png`), never absolute
paths, so nothing in Postgres needs rewriting.

## How reads work, and why they are not redirects

A request for `/uploads/logo-ab12cd34.png` is answered by the API: it fetches
the object and streams the bytes back. It does **not** redirect the browser to a
presigned URL. Three reasons, and they are specific to this application rather
than a general preference:

1. **The store usually has no name the browser can resolve.** The whole point of
   the in-cluster RustFS is a ClusterIP Service. A 302 to
   `http://trackarr-rustfs-svc:9000/...` goes nowhere from a visitor's machine.
   Making redirects work would mean publishing the object store on its own
   public hostname, with its own certificate, to save the API from copying
   40 KB.
2. **The response headers are a security control.** `/uploads/*` can serve an
   admin-uploaded SVG, and the routes answer with `X-Content-Type-Options:
   nosniff` and a `default-src 'none'; sandbox` CSP precisely so a hostile SVG
   cannot execute if someone opens the file URL directly. Redirect, and those
   headers come from the object store — which will not set them.
3. **Authorisation stays with the API.** The uploads routes are open today, but
   gating them behind a session is a plausible next step for a private tracker.
   A presigned URL is a bearer token that outlives the request: shareable, not
   revocable before it expires, and invisible to the application.

The cost is that the bytes cross the API. For branding images capped at 5 MB and
served with a one-year `immutable` `Cache-Control`, that is a rounding error next
to announce traffic — and a CDN or the ingress cache absorbs the repeats.

## Verifying it works

Upload a logo in **Admin → Branding**, then fetch it back:

```bash
curl -sI https://tracker.example.com/uploads/<the-filename>.png
```

A `200` with the right `Content-Type` means the whole path worked — the write
reached the bucket and the read came back through the API. A `404` after a
successful upload means the write and the read disagree about the key, which in
practice means `S3_PREFIX` changed between them.

The API logs the resolved backend once, on first use:

```
[Storage] s3 http://rustfs-svc:9000 bucket=trackarr-uploads region=us-east-1 path-style
```

Configuration is resolved lazily rather than at boot, deliberately: a typo in
the S3 settings surfaces as a 500 on the first upload naming the missing
variable, instead of a crash-loop that also takes down `/api/health`, the
tracker's health probe and every page the web tier renders.

## Troubleshooting

| Symptom | Cause |
| --- | --- |
| `403 SignatureDoesNotMatch` on every request | wrong secret key, or `S3_REGION` disagrees with the bucket's — the region is part of the signing scope |
| `404 NoSuchBucket` on the first upload | the bucket does not exist and `S3_CREATE_BUCKET` is off |
| Works with `curl`, `403` from the API | `S3_FORCE_PATH_STYLE` — a path-style request to a virtual-hosted-only endpoint signs a different host than it reaches |
| Uploads succeed, reads 404 | `S3_PREFIX` differs from the value in force when the file was written |
| `STORAGE_DRIVER=s3 but S3_ENDPOINT … not set` | exactly what it says; each name in that message also accepts `<NAME>_FILE` |
| Timeouts under load | `S3_TIMEOUT_MS` (default 30 000) is per request, and the store is on the critical path of a page render |

## Implementation notes

`apps/api/utils/storage/`:

- `keys.ts` — the shared key derivation. Both drivers normalise through it, so
  a file written under one is addressable under the other, and neither can be
  walked out of. `..` is **rejected** rather than resolved: it is inert on a
  filesystem after a prefix check, but `fetch()` collapses it in a URL before
  the request is sent, which on S3 is a real prefix escape.

  For a request this is the second layer — `middleware/security.ts` answers
  400 to any path containing `..`, and h3 decodes the path before routing, so
  the percent-encoded spellings land there too. It is the only layer for keys
  that never came from a URL: the branding routes derive one from the stored
  setting when deleting the file they replace.
- `sigv4.ts` — AWS Signature V4, hand-rolled. The v3 SDK plus its presigner is
  ~90 packages for four verbs against one bucket, and nothing here needs
  multipart, cross-region redirects or the credential-provider chain. Checked
  against AWS's published worked example in `test/storageSigv4.test.ts`.
- `fsDriver.ts` — the historical behaviour, including the `realpath` containment
  check that catches a symlink inside the uploads directory pointing out of it.
- `s3Driver.ts` — the S3 verbs, with the read-path reasoning above in the module
  header.

`test/integration/objectStorage.itest.ts` runs the driver against a real RustFS
that `apps/api/scripts/run-integration-tests.sh` starts. It is the only thing
that can check the part unit tests cannot: that the bytes signed are the bytes
sent.
