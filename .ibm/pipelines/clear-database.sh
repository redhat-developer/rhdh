#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# Clears all databases and migration tables from the shared RDS PostgreSQL instance
# This ensures that each test run starts with a clean state, preventing migration
# conflicts between different RHDH versions (e.g., release-1.7 vs main branch)
#
# SECURITY NOTE: This script drops ALL non-system databases on the target RDS instance.
# Ensure that:
# - RDS_1_HOST points to an isolated CI/test database instance
# - Credentials have limited scope to CI databases only
# - The RDS instance is NOT shared with production or other environments
clear_database() {
  set -euo pipefail

  log::section "PostgreSQL Database Cleanup"

  # Validate required environment variables
  if [[ -z "${RDS_USER:-}" ]] || [[ -z "${RDS_PASSWORD:-}" ]] || [[ -z "${RDS_1_HOST:-}" ]]; then
    log::error "Required environment variables not set: RDS_USER, RDS_PASSWORD, RDS_1_HOST"
    return 1
  fi

  POSTGRES_USER="$(echo -n "$RDS_USER" | base64 --decode)"
  export POSTGRES_USER
  export PGPASSWORD=$RDS_PASSWORD
  export POSTGRES_HOST=$RDS_1_HOST

  log::info "Target PostgreSQL host: $POSTGRES_HOST"
  log::debug "PostgreSQL user: $POSTGRES_USER"

  # Test database connectivity
  log::debug "Testing database connectivity..."
  if ! psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -c "SELECT 1;" &> /dev/null; then
    log::error "Failed to connect to PostgreSQL at $POSTGRES_HOST"
    return 1
  fi
  log::success "Successfully connected to PostgreSQL"

  # Get list of databases, excluding system databases
  log::debug "Retrieving list of databases..."
  local databases
  databases=$(
    psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -Atc \
      "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres', 'rdsadmin');" 2> /dev/null
  )

  if [[ $? -ne 0 ]]; then
    log::error "Failed to retrieve database list"
    return 1
  fi

  if [[ -z "$databases" ]]; then
    log::info "No user databases found to drop"
  else
    log::info "Found $(echo "$databases" | wc -l | tr -d ' ') database(s) to drop"
    log::debug "Databases: $(echo "$databases" | tr '\n' ' ')"

    # Drop each database
    for db in $databases; do
      log::info "Processing database: $db"

      # Terminate all active connections to the database before dropping
      log::debug "  Terminating active connections..."
      psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -c \
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid();" &> /dev/null || true

      # Drop the database
      log::debug "  Dropping database..."
      if psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -c "DROP DATABASE IF EXISTS \"$db\";" &> /dev/null; then
        log::success "  Database '$db' dropped successfully"
      else
        log::warn "  Failed to drop database '$db', continuing cleanup"
      fi
    done
  fi

  # Clean migration tables in the default 'postgres' database
  log::info "Checking for Knex migration tables..."

  local migration_tables
  migration_tables=$(
    psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -Atc \
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'knex_%';" 2> /dev/null || echo ""
  )

  if [[ -n "$migration_tables" ]]; then
    local table_count
    table_count=$(echo "$migration_tables" | wc -l | tr -d ' ')
    log::info "Found $table_count Knex migration table(s)"
    log::debug "Tables: $(echo "$migration_tables" | tr '\n' ' ')"

    for table in $migration_tables; do
      log::debug "  Dropping table: $table"
      if psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -c "DROP TABLE IF EXISTS \"$table\" CASCADE;" &> /dev/null; then
        log::success "  Table '$table' dropped successfully"
      else
        log::warn "  Failed to drop table '$table', continuing"
      fi
    done
  else
    log::info "No Knex migration tables found"
  fi

  log::hr
  log::success "Database cleanup completed successfully"
  log::info "Next RHDH deployment will start with a clean state"
}
