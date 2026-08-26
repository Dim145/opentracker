{{/*
Shared environment. Split out because all three services need the same
database and Valkey wiring and it must not drift between them.

Kubernetes expands $(VAR) only from variables declared EARLIER in the same
container's env list, and never from envFrom. So the credential parts are
declared individually first and the DSN is assembled from them — which also
keeps the password out of any ConfigMap and out of the rendered manifest.
*/}}

{{- define "trackarr.dbEnv" -}}
{{- if .Values.postgresql.enabled }}
- name: DB_USER
  valueFrom:
    secretKeyRef:
      name: {{ include "trackarr.pgAppSecret" . }}
      key: username
- name: DB_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "trackarr.pgAppSecret" . }}
      key: password
- name: DB_NAME
  valueFrom:
    secretKeyRef:
      name: {{ include "trackarr.pgAppSecret" . }}
      key: dbname
- name: DATABASE_URL
  value: {{ printf "postgres://$(DB_USER):$(DB_PASSWORD)@%s:5432/$(DB_NAME)?sslmode=%s" (include "trackarr.pgPoolerHost" .) .Values.database.sslMode | quote }}
{{- else if .Values.externalDatabase.existingSecret }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.externalDatabase.existingSecret }}
      key: DATABASE_URL
{{- else if .Values.externalDatabase.url }}
- name: DATABASE_URL
  value: {{ .Values.externalDatabase.url | quote }}
{{- else }}
{{- fail "postgresql.enabled is false: set externalDatabase.url or externalDatabase.existingSecret" }}
{{- end }}
- name: DB_SSL
  value: {{ eq .Values.database.sslMode "disable" | ternary "false" "true" | quote }}
{{- end -}}

{{/*
The migration DSN. It must reach Postgres directly: scripts/migrate.mjs takes a
SESSION-level pg_advisory_lock, and a session-level lock on a transaction-pooled
connection leaks to whoever borrows it next.
*/}}
{{- define "trackarr.dbMigrationEnv" -}}
{{- if .Values.postgresql.enabled }}
- name: MIGRATIONS_DATABASE_URL
  value: {{ printf "postgres://$(DB_USER):$(DB_PASSWORD)@%s:5432/$(DB_NAME)?sslmode=%s" (include "trackarr.pgRwHost" .) .Values.database.sslMode | quote }}
{{- else if .Values.externalDatabase.existingSecret }}
- name: MIGRATIONS_DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ .Values.externalDatabase.existingSecret }}
      key: MIGRATIONS_DATABASE_URL
      optional: true
{{- else if .Values.externalDatabase.migrationsUrl }}
- name: MIGRATIONS_DATABASE_URL
  value: {{ .Values.externalDatabase.migrationsUrl | quote }}
{{- end }}
{{- end -}}

{{- define "trackarr.redisEnv" -}}
{{- if .Values.valkey.enabled }}
- name: REDIS_URL
  value: {{ printf "redis://%s:6379" (include "trackarr.valkeyHost" .) | quote }}
{{- if .Values.valkey.auth.enabled }}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.externalRedis.existingSecret | default (printf "%s-valkey-auth" .Release.Name) }}
      key: VALKEY_PASSWORD
{{- end }}
{{- else if .Values.externalRedis.host }}
- name: REDIS_URL
  value: {{ printf "redis://%s:%v" .Values.externalRedis.host (.Values.externalRedis.port | default 6379) | quote }}
{{- if .Values.externalRedis.existingSecret }}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Values.externalRedis.existingSecret }}
      key: REDIS_PASSWORD
{{- else if .Values.externalRedis.password }}
- name: REDIS_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ .Release.Name }}-valkey-auth
      key: VALKEY_PASSWORD
{{- end }}
{{- else }}
{{- fail "valkey.enabled is false: set externalRedis.host" }}
{{- end }}
{{- end -}}

{{/*
Where the API puts uploaded files. Nothing is emitted for the `fs` driver:
UPLOADS_DIR is set next to the volume mount in api.yaml, and the application
defaults to `fs`, so an existing release keeps exactly the environment it had.
*/}}
{{- define "trackarr.storageEnv" -}}
{{- if eq .Values.storage.driver "s3" }}
{{- $s3 := .Values.storage.s3 }}
{{- $secret := include "trackarr.s3SecretName" . }}
- name: STORAGE_DRIVER
  value: "s3"
- name: S3_ENDPOINT
  value: {{ include "trackarr.s3Endpoint" . | quote }}
- name: S3_REGION
  value: {{ $s3.region | default "us-east-1" | quote }}
- name: S3_BUCKET
  value: {{ required "storage.s3.bucket is required when storage.driver is s3" $s3.bucket | quote }}
{{- with $s3.prefix }}
- name: S3_PREFIX
  value: {{ . | quote }}
{{- end }}
- name: S3_FORCE_PATH_STYLE
  value: {{ $s3.forcePathStyle | quote }}
- name: S3_CREATE_BUCKET
  value: {{ $s3.createBucket | quote }}
- name: S3_TIMEOUT_MS
  value: {{ $s3.timeoutMs | default 30000 | quote }}
- name: S3_ACCESS_KEY_ID
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: S3_ACCESS_KEY_ID
- name: S3_SECRET_ACCESS_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: S3_SECRET_ACCESS_KEY
{{- end }}
{{- end -}}

{{/* Non-secret config plus the three app secrets, for every container. */}}
{{- define "trackarr.envFrom" -}}
- configMapRef:
    name: {{ include "trackarr.configMapName" . }}
- secretRef:
    name: {{ include "trackarr.secretName" . }}
{{- with .Values.config.metadataExistingSecret }}
- secretRef:
    name: {{ . }}
    optional: true
{{- end }}
{{- end -}}

{{/* Metadata provider keys, when supplied inline rather than by secret ref. */}}
{{- define "trackarr.metadataEnv" -}}
{{- if not .Values.config.metadataExistingSecret }}
{{- with .Values.config.metadata.tmdbApiKey }}
- name: TMDB_API_KEY
  value: {{ . | quote }}
{{- end }}
{{- with .Values.config.metadata.igdbId }}
- name: IGDB_ID
  value: {{ . | quote }}
{{- end }}
{{- with .Values.config.metadata.igdbSecret }}
- name: IGDB_SECRET
  value: {{ . | quote }}
{{- end }}
{{- with .Values.config.metadata.googleBooksApiKey }}
- name: GOOGLE_BOOKS_API_KEY
  value: {{ . | quote }}
{{- end }}
{{- end }}
{{- end -}}

{{/*
Pod-level hardening applied to all three. The images already run as non-root
with a read-only root filesystem in Compose; this is the same posture expressed
in Kubernetes terms.
*/}}
{{- define "trackarr.podSecurityContext" -}}
runAsNonRoot: true
{{/*
65532 because that is what all three images actually are, verified in their
Dockerfiles rather than assumed: the api and web runtimes are
gcr.io/distroless/nodejs24-debian13:nonroot, whose `nonroot` user is 65532, and
apps/tracker/Dockerfile says `USER 65532:65532` with a comment about staying
consistent with them.

It used to say 1001, which worked only by accident — the bundles are
world-readable, so a mismatched uid could still execute them. Anything the
images had chosen to keep private would have failed, and `ls -l` inside a pod
disagreed with the image for no reason a reader could recover.
*/ -}}
runAsUser: 65532
runAsGroup: 65532
{{/*
fsGroup is what makes a volume writable: the kubelet chowns it to root:<fsGroup>
and adds g+rwx. Measured against the real image — root:65532 mode 2775 writes,
root:root mode 0755 fails with EACCES — so a CSI driver that ignores fsGroup
leaves the uploads PVC unwritable. Several NFS and CIFS provisioners do, and
those are exactly the ReadWriteMany classes `storage.driver: fs` asks for with
more than one replica. See doc/guide/troubleshooting.md.

UPGRADING an existing release: this value changed from 1001, so on the first
restart the kubelet re-chowns the uploads volume's group from 1001 to 65532.
Files keep working — they are reached through the group either way — and
OnRootMismatch keeps that walk to the one time it is needed instead of every
pod start, which is what makes a large volume slow to mount.
*/ -}}
fsGroup: 65532
fsGroupChangePolicy: OnRootMismatch
seccompProfile:
  type: RuntimeDefault
{{- end -}}

{{- define "trackarr.containerSecurityContext" -}}
allowPrivilegeEscalation: false
readOnlyRootFilesystem: true
privileged: false
capabilities:
  drop:
    - ALL
{{- end -}}
