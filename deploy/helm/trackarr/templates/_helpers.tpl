{{/* ------------------------------------------------------------------ names */}}

{{- define "trackarr.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "trackarr.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "trackarr.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* ----------------------------------------------------------------- labels */}}

{{- define "trackarr.labels" -}}
helm.sh/chart: {{ include "trackarr.chart" . }}
{{ include "trackarr.selectorLabels" . }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- with .Values.commonLabels }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{- define "trackarr.selectorLabels" -}}
app.kubernetes.io/name: {{ include "trackarr.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{/* Per-component labels. Call as (dict "ctx" $ "component" "api"). */}}
{{- define "trackarr.componentLabels" -}}
{{ include "trackarr.labels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "trackarr.componentSelectorLabels" -}}
{{ include "trackarr.selectorLabels" .ctx }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "trackarr.annotations" -}}
{{- with .Values.commonAnnotations }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/* -------------------------------------------------------------- image refs */}}

{{/* (dict "ctx" $ "image" .Values.api.image) */}}
{{- define "trackarr.image" -}}
{{- $tag := .image.tag | default .ctx.Values.image.tag | default .ctx.Chart.AppVersion -}}
{{- printf "%s/%s:%s" (.ctx.Values.image.registry | trimSuffix "/") .image.repository $tag -}}
{{- end -}}

{{- define "trackarr.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "trackarr.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/* ------------------------------------------------------------ subchart names

The Postgres subchart is aliased, so its resources are named after the ALIAS,
not after its upstream chart name. Rendered and verified rather than assumed:

  postgresql  -> Cluster {release}-postgresql
                 services {release}-postgresql-rw / -ro / -r
                 Pooler   {release}-postgresql-pooler-rw
                 Secret   {release}-postgresql-app  (username/password/dbname)
  valkey      -> Service  {release}-valkey
  rustfs      -> Service  {release}-rustfs-svc  (S3 API on 9000)
                 Secret   {release}-rustfs-secret
                                                                             */}}

{{- define "trackarr.pgClusterName" -}}
{{- printf "%s-postgresql" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Read-write endpoint. Always the current primary; CNPG moves it on failover. */}}
{{- define "trackarr.pgRwHost" -}}
{{- printf "%s-rw" (include "trackarr.pgClusterName" .) -}}
{{- end -}}

{{/* The pooler if one is declared, otherwise straight at the primary. */}}
{{- define "trackarr.pgPoolerHost" -}}
{{- $poolers := .Values.postgresql.poolers | default list -}}
{{- $rw := "" -}}
{{- range $poolers -}}
{{- if and (eq (.type | default "rw") "rw") (not $rw) -}}
{{- $rw = .name -}}
{{- end -}}
{{- end -}}
{{- if $rw -}}
{{- printf "%s-pooler-%s" (include "trackarr.pgClusterName" $) $rw -}}
{{- else -}}
{{- include "trackarr.pgRwHost" . -}}
{{- end -}}
{{- end -}}

{{- define "trackarr.pgAppSecret" -}}
{{- printf "%s-app" (include "trackarr.pgClusterName" .) -}}
{{- end -}}

{{- define "trackarr.valkeyHost" -}}
{{- printf "%s-valkey" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
The RustFS subchart follows the same aliasing rule: its `rustfs.fullname` is
`{release}-rustfs` unless the release name already contains "rustfs", and the
Service it exposes the S3 API on is that plus `-svc`. Rendered and verified,
not assumed.
*/}}
{{- define "trackarr.rustfsFullname" -}}
{{- if contains "rustfs" .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-rustfs" .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "trackarr.rustfsEndpoint" -}}
{{- $port := (((.Values.rustfs).service).endpoint).port | default 9000 -}}
{{- printf "http://%s-svc:%v" (include "trackarr.rustfsFullname" .) $port -}}
{{- end -}}

{{/* ----------------------------------------------------------- object store

`storage.s3.*` wins; otherwise the bundled RustFS supplies both the endpoint
and the credentials. Helm cannot pass a generated value INTO a subchart's
values, so unlike the session and IP-hash secrets these cannot be minted for
you — they have to be written down once, and the natural place is next to the
store that enforces them.
                                                                             */}}

{{- define "trackarr.s3Endpoint" -}}
{{- $explicit := .Values.storage.s3.endpoint | default "" -}}
{{- if $explicit -}}
{{- $explicit -}}
{{- else if .Values.rustfs.enabled -}}
{{- include "trackarr.rustfsEndpoint" . -}}
{{- else -}}
{{- fail "storage.driver is s3 but storage.s3.endpoint is empty and rustfs.enabled is false — set one of them" -}}
{{- end -}}
{{- end -}}

{{/*
The name of the Secret this chart creates for the object store.

With the bundled RustFS it must be the LITERAL in rustfs.secret.existingSecret,
because that value reaches the subchart unrendered — its _helpers.tpl emits it
raw, so a `{{ .Release.Name }}` in there would land in a manifest verbatim. One
value therefore names the Secret on both sides and they cannot drift. Overriding
it is also how a second release in one namespace stays out of the first's way.

Without RustFS there is no subchart to agree with, so the name is release-scoped
as usual.
*/}}
{{- define "trackarr.s3SecretName" -}}
{{- if .Values.storage.s3.existingSecret -}}
{{- .Values.storage.s3.existingSecret -}}
{{- else if and .Values.rustfs.enabled (((.Values.rustfs).secret).existingSecret) -}}
{{- ((.Values.rustfs).secret).existingSecret -}}
{{- else -}}
{{- printf "%s-s3-auth" .Release.Name -}}
{{- end -}}
{{- end -}}

{{/*
The object-store credentials, generated when nobody supplied them.

Read back from the Secret first, for the same reason as the app secrets: a bare
randAlphaNum would mint a new pair on every `helm upgrade`, and rotating these
locks the API out of every object RustFS already holds — the server would come
up with new keys while the running API still presents the old ones, or the other
way round depending on which pod restarts first.

Generated ONLY for the bundled RustFS. An external store's credentials are not
ours to invent, so that path still requires them and assertS3Credentials still
refuses to render without them.
*/}}
{{- define "trackarr.s3GeneratedCredential" -}}
{{- $name := include "trackarr.s3SecretName" .ctx -}}
{{- $existing := lookup "v1" "Secret" .ctx.Release.Namespace $name -}}
{{- $current := "" -}}
{{- if and $existing $existing.data -}}
{{- $current = index $existing.data .key | default "" -}}
{{- end -}}
{{- if $current -}}
{{- $current | b64dec -}}
{{- else -}}
{{- randAlphaNum (.len | int) -}}
{{- end -}}
{{- end -}}

{{- define "trackarr.s3AccessKeyId" -}}
{{- $explicit := .Values.storage.s3.accessKeyId | default (and .Values.rustfs.enabled (((.Values.rustfs).secret).rustfs).access_key) | default "" -}}
{{- if $explicit -}}
{{- $explicit -}}
{{- else if .Values.rustfs.enabled -}}
{{- include "trackarr.s3GeneratedCredential" (dict "ctx" . "key" "S3_ACCESS_KEY_ID" "len" 24) -}}
{{- end -}}
{{- end -}}

{{- define "trackarr.s3SecretAccessKey" -}}
{{- $explicit := .Values.storage.s3.secretAccessKey | default (and .Values.rustfs.enabled (((.Values.rustfs).secret).rustfs).secret_key) | default "" -}}
{{- if $explicit -}}
{{- $explicit -}}
{{- else if .Values.rustfs.enabled -}}
{{- include "trackarr.s3GeneratedCredential" (dict "ctx" . "key" "S3_SECRET_ACCESS_KEY" "len" 48) -}}
{{- end -}}
{{- end -}}

{{/*
Where the API's S3 credentials come from. Three cases, checked in order, and
the last one stops the render rather than shipping an API that 500s on the
first upload.
*/}}
{{- define "trackarr.assertS3Credentials" -}}
{{/* Endpoint first: it is the more fundamental of the two, so an operator who
     set neither should be told about it rather than about credentials for a
     store the chart cannot even name. */}}
{{- $_ := include "trackarr.s3Endpoint" . -}}
{{- if not .Values.storage.s3.existingSecret -}}
{{- $id := include "trackarr.s3AccessKeyId" . -}}
{{- $key := include "trackarr.s3SecretAccessKey" . -}}
{{- if or (not $id) (not $key) -}}
{{- fail "storage.driver is s3 with an external store, but no credentials were given. Set storage.s3.accessKeyId + storage.s3.secretAccessKey, or storage.s3.existingSecret (keys S3_ACCESS_KEY_ID / S3_SECRET_ACCESS_KEY). Credentials are only generated for the bundled store — set rustfs.enabled if that is what you wanted." -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
`storage.driver` must be one of the two the application knows. Without this the
chart treated anything that is not "s3" as "fs" — so a typo, or a plausible
guess like `minio`, deployed an fs-mode API with a PVC and silently ignored what
the operator asked for. utils/storage/index.ts already refuses an unknown
STORAGE_DRIVER at runtime; this makes the chart refuse it at render time, which
is where it is cheap to fix.
*/}}
{{- define "trackarr.assertStorageDriver" -}}
{{- $d := .Values.storage.driver | default "" -}}
{{- if not (or (eq $d "fs") (eq $d "s3")) -}}
{{- fail (printf "storage.driver must be \"fs\" or \"s3\" (got %q)" $d) -}}
{{- end -}}
{{- end -}}

{{/* True when uploads need a filesystem volume, i.e. the fs driver is in use. */}}
{{- define "trackarr.uploadsVolumeEnabled" -}}
{{- if and .Values.api.uploads.enabled (ne .Values.storage.driver "s3") -}}
true
{{- end -}}
{{- end -}}

{{/* --------------------------------------------------------------- our names */}}

{{- define "trackarr.secretName" -}}
{{- if .Values.secrets.existingSecret -}}
{{- .Values.secrets.existingSecret -}}
{{- else -}}
{{- printf "%s-secrets" (include "trackarr.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "trackarr.configMapName" -}}
{{- if .Values.config.existingConfigMap -}}
{{- .Values.config.existingConfigMap -}}
{{- else -}}
{{- printf "%s-config" (include "trackarr.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "trackarr.uploadsClaimName" -}}
{{- if .Values.api.uploads.existingClaim -}}
{{- .Values.api.uploads.existingClaim -}}
{{- else -}}
{{- printf "%s-uploads" (include "trackarr.fullname" .) -}}
{{- end -}}
{{- end -}}

{{/* ------------------------------------------------------------------- URLs */}}

{{- define "trackarr.trackerHttpUrl" -}}
{{- .Values.site.trackerHttpUrl | default (printf "https://%s/announce" .Values.site.host) -}}
{{- end -}}

{{- define "trackarr.trackerUdpUrl" -}}
{{- .Values.site.trackerUdpUrl | default (printf "udp://%s:%v/announce" .Values.site.host .Values.tracker.udp.port) -}}
{{- end -}}

{{- define "trackarr.trackerWsUrl" -}}
{{- .Values.site.trackerWsUrl | default (printf "wss://%s/ws" .Values.site.host) -}}
{{- end -}}

{{- define "trackarr.tlsSecretName" -}}
{{- .Values.ingress.tls.secretName | default (printf "%s-tls" (include "trackarr.fullname" .)) -}}
{{- end -}}

{{/* ---------------------------------------------------------- generated keys

A `helm upgrade` re-renders every template, so a bare randAlphaNum would mint a
new value each time — signing every member out and breaking IP-hash continuity
against rows already in the database. Read our own Secret back first and reuse
what is there; generate only on the very first install.

`lookup` returns an empty map under `helm template` and `--dry-run`, so those
show a fresh value. Nothing is applied, so nothing rotates.

Call as (dict "ctx" $ "key" "IP_HASH_SECRET" "override" .Values.secrets.x "len" 64).
                                                                             */}}
{{- define "trackarr.stableSecret" -}}
{{- if .override -}}
{{- .override -}}
{{- else -}}
{{- $name := printf "%s-secrets" (include "trackarr.fullname" .ctx) -}}
{{- $existing := lookup "v1" "Secret" .ctx.Release.Namespace $name -}}
{{- $current := "" -}}
{{- if and $existing $existing.data -}}
{{- $current = index $existing.data .key | default "" -}}
{{- end -}}
{{- if $current -}}
{{- $current | b64dec -}}
{{- else -}}
{{- randAlphaNum (.len | int) -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
The Valkey password lives in its own Secret, so it needs its own lookup rather
than trackarr.stableSecret's (which reads the app Secret).
*/}}
{{- define "trackarr.valkeyPassword" -}}
{{- if .Values.externalRedis.password -}}
{{- .Values.externalRedis.password -}}
{{- else -}}
{{- $name := printf "%s-valkey-auth" .Release.Name -}}
{{- $existing := lookup "v1" "Secret" .Release.Namespace $name -}}
{{- $current := "" -}}
{{- if and $existing $existing.data -}}
{{- $current = index $existing.data "VALKEY_PASSWORD" | default "" -}}
{{- end -}}
{{- if $current -}}
{{- $current | b64dec -}}
{{- else -}}
{{- randAlphaNum 40 -}}
{{- end -}}
{{- end -}}
{{- end -}}
