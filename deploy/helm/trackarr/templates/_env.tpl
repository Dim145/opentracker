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
{{- $secret := $s3.existingSecret | default (printf "%s-s3-auth" .Release.Name) }}
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
runAsUser: 1001
runAsGroup: 1001
fsGroup: 1001
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
