#!/bin/bash

# shellcheck source=.ibm/pipelines/lib/log.sh
source "${DIR}/lib/log.sh"

# Clears all databases and migration tables from the shared RDS PostgreSQL instance
# This ensures that each test run starts with a clean state, preventing migration
# conflicts between different RHDH versions (e.g., release-1.7 vs main branch)
clear_database() {
  set -euo pipefail

  export POSTGRES_USER="$(echo -n "$RDS_USER" | base64 --decode)"
  export PGPASSWORD=$RDS_PASSWORD
  export POSTGRES_HOST=$RDS_1_HOST

  log::info "Starting comprehensive database cleanup process..."
  log::info "Target PostgreSQL host: $POSTGRES_HOST"
  log::info "PostgreSQL user: $POSTGRES_USER"

  # Test database connectivity
  if ! psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -c "SELECT 1;" &>/dev/null; then
    log::error "Failed to connect to PostgreSQL at $POSTGRES_HOST"
    return 1
  fi
  log::success "Successfully connected to PostgreSQL"

  # Get list of databases, excluding system databases
  local databases
  databases=$(
    psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -Atc \
      "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres', 'rdsadmin');" 2>/dev/null
  )

  if [ $? -ne 0 ]; then
    log::error "Failed to retrieve database list"
    return 1
  fi

  if [ -z "$databases" ]; then
    log::info "No databases found to drop"
  else
    log::info "Found databases to drop: $(echo "$databases" | tr '\n' ' ')"

    # Drop each database
    for db in $databases; do
      log::info "Dropping database: $db"

      # Terminate all active connections to the database before dropping
      psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -c \
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid();" &>/dev/null || true

      # Drop the database
      if psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -c "DROP DATABASE IF EXISTS \"$db\";" 2>&1; then
        log::success "Successfully dropped database: $db"
      else
        log::warn "Failed to drop database $db, but continuing with cleanup"
      fi
    done
  fi

  # Additionally, if there's a 'postgres' database being used by RHDH, clean migration tables
  # This handles the case where RHDH might be using the default 'postgres' database
  log::info "Checking for Knex migration tables in 'postgres' database..."

  local migration_tables
  migration_tables=$(
    psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -Atc \
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'knex_%';" 2>/dev/null || echo ""
  )

  if [ -n "$migration_tables" ]; then
    log::info "Found Knex migration tables: $(echo "$migration_tables" | tr '\n' ' ')"
    for table in $migration_tables; do
      log::info "Dropping migration table: $table"
      if psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -c "DROP TABLE IF EXISTS \"$table\" CASCADE;" 2>&1; then
        log::success "Successfully dropped table: $table"
      else
        log::warn "Failed to drop table $table, but continuing"
      fi
    done
  else
    log::info "No Knex migration tables found in 'postgres' database"
  fi

  log::success "Database cleanup process completed successfully"
  log::info "All databases and migration tables have been removed"
  log::info "Next RHDH deployment will start with a clean database state"
}