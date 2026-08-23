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

The two subcharts are aliased, so their resources are named after the ALIAS,
not after their upstream chart name. Rendered and verified rather than assumed:

  postgresql  -> Cluster {release}-postgresql
                 services {release}-postgresql-rw / -ro / -r
                 Pooler   {release}-postgresql-pooler-rw
                 Secret   {release}-postgresql-app  (username/password/dbname)
  valkey      -> Service  {release}-valkey
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
