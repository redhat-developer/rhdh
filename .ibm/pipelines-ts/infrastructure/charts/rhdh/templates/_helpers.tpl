{{/*
RHDH Helm Chart Helpers
This file provides reusable template functions to eliminate code duplication
*/}}

{{/*
Expand the name of the chart.
*/}}
{{- define "rhdh.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "rhdh.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "rhdh.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "rhdh.labels" -}}
helm.sh/chart: {{ include "rhdh.chart" . }}
{{ include "rhdh.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
app.kubernetes.io/part-of: rhdh
{{- end }}

{{/*
Selector labels
*/}}
{{- define "rhdh.selectorLabels" -}}
app.kubernetes.io/name: {{ include "rhdh.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "rhdh.serviceAccountName" -}}
{{- if .Values.rbac.serviceAccount.create }}
{{- default (include "rhdh.fullname" .) .Values.rbac.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.rbac.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
Determine cluster type - replaces manual cluster detection logic
*/}}
{{- define "rhdh.clusterType" -}}
{{- if .Values.global.clusterType }}
{{- .Values.global.clusterType }}
{{- else if .Capabilities.APIVersions.Has "route.openshift.io/v1" }}
{{- "openshift" }}
{{- else if .Capabilities.APIVersions.Has "networking.gke.io/v1beta1" }}
{{- "gke" }}
{{- else }}
{{- "kubernetes" }}
{{- end }}
{{- end }}

{{/*
Generate base URL based on cluster type - replaces manual URL construction
*/}}
{{- define "rhdh.baseUrl" -}}
{{- $clusterType := include "rhdh.clusterType" . }}
{{- if .Values.appConfig.baseUrl }}
{{- .Values.appConfig.baseUrl }}
{{- else if eq $clusterType "openshift" }}
{{- printf "https://%s-%s.%s" (include "rhdh.fullname" .) .Release.Namespace .Values.global.clusterRouterBase }}
{{- else }}
{{- printf "https://%s.%s" (include "rhdh.fullname" .) .Values.global.clusterRouterBase }}
{{- end }}
{{- end }}

{{/*
Generate backend URL - same as base URL for now
*/}}
{{- define "rhdh.backendUrl" -}}
{{- include "rhdh.baseUrl" . }}
{{- end }}

{{/*
PostgreSQL connection string - replaces manual database configuration
*/}}
{{- define "rhdh.postgresql.connectionString" -}}
{{- if .Values.external.postgresql.enabled }}
{{- printf "postgresql://%s:%s@%s:%d/%s" .Values.external.postgresql.username .Values.external.postgresql.password .Values.external.postgresql.host (.Values.external.postgresql.port | int) .Values.external.postgresql.database }}
{{- else if .Values.postgresql.enabled }}
{{- printf "postgresql://%s:%s@%s-postgresql:%d/%s" .Values.postgresql.auth.username .Values.postgresql.auth.password (include "rhdh.fullname" .) (5432 | int) .Values.postgresql.auth.database }}
{{- else }}
{{- "" }}
{{- end }}
{{- end }}

{{/*
Redis connection string - replaces manual Redis configuration
*/}}
{{- define "rhdh.redis.connectionString" -}}
{{- if .Values.external.redis.enabled }}
{{- if .Values.external.redis.password }}
{{- printf "redis://:%s@%s:%d" .Values.external.redis.password .Values.external.redis.host (.Values.external.redis.port | int) }}
{{- else }}
{{- printf "redis://%s:%d" .Values.external.redis.host (.Values.external.redis.port | int) }}
{{- end }}
{{- else if .Values.redis.enabled }}
{{- printf "redis://%s-redis-master:6379" (include "rhdh.fullname" .) }}
{{- else }}
{{- "" }}
{{- end }}
{{- end }}

{{/*
Cluster-specific overrides - replaces manual cluster detection in values
*/}}
{{- define "rhdh.clusterOverrides" -}}
{{- $clusterType := include "rhdh.clusterType" . }}
{{- $overrides := dict }}
{{- if eq $clusterType "openshift" }}
{{- $overrides = .Values.clusterOverrides.openshift }}
{{- else if eq $clusterType "aks" }}
{{- $overrides = .Values.clusterOverrides.aks }}
{{- else if eq $clusterType "gke" }}
{{- $overrides = .Values.clusterOverrides.gke }}
{{- end }}
{{- $overrides | toYaml }}
{{- end }}

{{/*
Ingress enabled check - replaces manual ingress logic
*/}}
{{- define "rhdh.ingress.enabled" -}}
{{- $clusterType := include "rhdh.clusterType" . }}
{{- if eq $clusterType "openshift" }}
{{- false }}
{{- else }}
{{- .Values.networking.ingress.enabled }}
{{- end }}
{{- end }}

{{/*
Route enabled check - replaces manual route logic
*/}}
{{- define "rhdh.route.enabled" -}}
{{- $clusterType := include "rhdh.clusterType" . }}
{{- if eq $clusterType "openshift" }}
{{- .Values.networking.route.enabled }}
{{- else }}
{{- false }}
{{- end }}
{{- end }}

{{/*
Image pull secrets - consolidates image pull secret logic
*/}}
{{- define "rhdh.imagePullSecrets" -}}
{{- $secrets := list }}
{{- if .Values.global.imagePullSecrets }}
{{- $secrets = concat $secrets .Values.global.imagePullSecrets }}
{{- end }}
{{- if .Values.backstage.image.pullSecrets }}
{{- $secrets = concat $secrets .Values.backstage.image.pullSecrets }}
{{- end }}
{{- if $secrets }}
imagePullSecrets:
{{- range $secrets }}
  - name: {{ . }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Security context - applies cluster-specific security context
*/}}
{{- define "rhdh.securityContext" -}}
{{- $clusterType := include "rhdh.clusterType" . }}
{{- if eq $clusterType "openshift" }}
runAsNonRoot: true
runAsUser: 1001
fsGroup: 1001
{{- else }}
{{ .Values.security.securityContext | toYaml }}
{{- end }}
{{- end }}

{{/*
Pod security context - applies cluster-specific pod security context  
*/}}
{{- define "rhdh.podSecurityContext" -}}
{{- $clusterType := include "rhdh.clusterType" . }}
{{- if eq $clusterType "openshift" }}
runAsNonRoot: true
runAsUser: 1001
fsGroup: 1001
{{- else }}
{{ .Values.security.podSecurityContext | toYaml }}
{{- end }}
{{- end }}

{{/*
Environment variables - consolidates all environment variable sources
*/}}
{{- define "rhdh.environmentVariables" -}}
- name: NODE_ENV
  value: "production"
- name: APP_CONFIG_backend_baseUrl
  value: {{ include "rhdh.backendUrl" . | quote }}
- name: APP_CONFIG_app_baseUrl  
  value: {{ include "rhdh.baseUrl" . | quote }}
{{- if .Values.postgresql.enabled }}
- name: POSTGRES_HOST
  value: {{ include "rhdh.fullname" . }}-postgresql
- name: POSTGRES_PORT
  value: "5432"
- name: POSTGRES_USER
  value: {{ .Values.postgresql.auth.username | quote }}
- name: POSTGRES_PASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "rhdh.fullname" . }}-postgresql
      key: password
- name: POSTGRES_DB
  value: {{ .Values.postgresql.auth.database | quote }}
{{- end }}
{{- if .Values.redis.enabled }}
- name: REDIS_HOST
  value: {{ include "rhdh.fullname" . }}-redis-master
- name: REDIS_PORT
  value: "6379"
{{- end }}
{{- range .Values.backstage.extraEnvVars }}
- name: {{ .name }}
  value: {{ .value | quote }}
{{- end }}
{{- end }}

{{/*
Resource limits and requests - applies appropriate resources based on configuration
*/}}
{{- define "rhdh.resources" -}}
{{- if .Values.rbac.enabled }}
{{ .Values.backstage.resources | toYaml }}
{{- else }}
{{ .Values.backstage.resources | toYaml }}
{{- end }}
{{- end }}

{{/*
Validate configuration - prevents common configuration errors
*/}}
{{- define "rhdh.validateConfig" -}}
{{- if not .Values.global.clusterRouterBase }}
{{- fail "global.clusterRouterBase is required" }}
{{- end }}
{{- if and .Values.postgresql.enabled .Values.external.postgresql.enabled }}
{{- fail "Cannot enable both internal and external PostgreSQL" }}
{{- end }}
{{- if and .Values.redis.enabled .Values.external.redis.enabled }}
{{- fail "Cannot enable both internal and external Redis" }}
{{- end }}
{{- end }} 