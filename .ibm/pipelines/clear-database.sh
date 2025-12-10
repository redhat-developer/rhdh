#!/bin/bash

# Clears all databases and migration tables from the shared RDS PostgreSQL instances
# This ensures that each test run starts with a clean state, preventing migration
# conflicts between different RHDH versions (e.g., release-1.7 vs main branch)
#
# SECURITY NOTE: This script drops ALL non-system databases on the target RDS instances.
# Ensure that:
# - RDS hosts point to isolated CI/test database instances
# - Credentials have limited scope to CI databases only
# - The RDS instances are NOT shared with production or other environments

# Clean a single PostgreSQL database instance
# Arguments:
#   $1 - Host address
#   $2 - Host identifier (for logging, e.g., "RDS_1")
clean_single_database() {
  local host=$1
  local host_id=$2
  
  echo "[INFO] Cleaning database on ${host_id} (${host})..."
  
  # Test database connectivity
  if ! psql -h "$host" -U "$POSTGRES_USER" -p "5432" -d postgres -c "SELECT 1;" &> /dev/null; then
    echo "[ERROR] Failed to connect to PostgreSQL at ${host_id} (${host})"
    return 1
  fi
  echo "[SUCCESS] Successfully connected to ${host_id}"

  # Get list of databases, excluding system databases
  local databases
  databases=$(
    psql -h "$host" -U "$POSTGRES_USER" -p "5432" -d postgres -Atc \
      "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres', 'rdsadmin');" 2> /dev/null
  )

  if [[ $? -ne 0 ]]; then
    echo "[ERROR] Failed to retrieve database list from ${host_id}"
    return 1
  fi

  if [[ -z "$databases" ]]; then
    echo "[INFO] No user databases found to drop on ${host_id}"
  else
    echo "[INFO] Found $(echo "$databases" | wc -l | tr -d ' ') database(s) to drop on ${host_id}"
    echo "[DEBUG] Databases: $(echo "$databases" | tr '\n' ' ')"

    # Drop each database
    for db in $databases; do
      echo "[INFO]   Processing database: $db"

      # Terminate all active connections to the database before dropping
      psql -h "$host" -U "$POSTGRES_USER" -p "5432" -d postgres -c \
        "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '$db' AND pid <> pg_backend_pid();" &> /dev/null || true

      # Drop the database
      if psql -h "$host" -U "$POSTGRES_USER" -p "5432" -d postgres -c "DROP DATABASE IF EXISTS \"$db\";" &> /dev/null; then
        echo "[SUCCESS]     Database '$db' dropped successfully"
      else
        echo "[WARN]     Failed to drop database '$db', continuing cleanup"
      fi
    done
  fi

  # Clean migration tables in the default 'postgres' database
  echo "[INFO] Checking for Knex migration tables on ${host_id}..."

  local migration_tables
  migration_tables=$(
    psql -h "$host" -U "$POSTGRES_USER" -p "5432" -d postgres -Atc \
      "SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename LIKE 'knex_%';" 2> /dev/null || echo ""
  )

  if [[ -n "$migration_tables" ]]; then
    local table_count
    table_count=$(echo "$migration_tables" | wc -l | tr -d ' ')
    echo "[INFO] Found $table_count Knex migration table(s) on ${host_id}"
    echo "[DEBUG] Tables: $(echo "$migration_tables" | tr '\n' ' ')"

    for table in $migration_tables; do
      if psql -h "$host" -U "$POSTGRES_USER" -p "5432" -d postgres -c "DROP TABLE IF EXISTS \"$table\" CASCADE;" &> /dev/null; then
        echo "[SUCCESS]     Table '$table' dropped successfully"
      else
        echo "[WARN]     Failed to drop table '$table', continuing"
      fi
    done
  else
    echo "[INFO] No Knex migration tables found on ${host_id}"
  fi
  
  echo "[SUCCESS] Cleanup completed for ${host_id}"
  echo ""
}

# Main cleanup function that iterates over all RDS hosts
clear_database() {
  set -euo pipefail

  echo "========================================"
  echo "PostgreSQL Database Cleanup - Multiple RDS Instances"
  echo "========================================"

  # Validate required environment variables
  if [[ -z "${RDS_USER:-}" ]] || [[ -z "${RDS_PASSWORD:-}" ]]; then
    echo "[ERROR] Required environment variables not set: RDS_USER, RDS_PASSWORD"
    return 1
  fi

  # Decode PostgreSQL user and set password for psql
  POSTGRES_USER="$(echo -n "$RDS_USER" | base64 --decode)"
  export POSTGRES_USER
  export PGPASSWORD=$RDS_PASSWORD

  echo "[INFO] PostgreSQL user: $POSTGRES_USER"
  
  # List of RDS hosts to clean (RDS_1, RDS_2, RDS_3)
  local -a rds_hosts=()
  [[ -n "${RDS_1_HOST:-}" ]] && rds_hosts+=("RDS_1_HOST:$RDS_1_HOST")
  [[ -n "${RDS_2_HOST:-}" ]] && rds_hosts+=("RDS_2_HOST:$RDS_2_HOST")
  [[ -n "${RDS_3_HOST:-}" ]] && rds_hosts+=("RDS_3_HOST:$RDS_3_HOST")
  
  if [[ ${#rds_hosts[@]} -eq 0 ]]; then
    echo "[ERROR] No RDS hosts configured (RDS_1_HOST, RDS_2_HOST, RDS_3_HOST)"
    return 1
  fi
  
  echo "[INFO] Found ${#rds_hosts[@]} RDS host(s) to clean"
  echo "========================================"
  
  # Clean each RDS host
  local failed_hosts=()
  for rds_host in "${rds_hosts[@]}"; do
    local host_id="${rds_host%%:*}"
    local host_addr="${rds_host#*:}"
    
    if ! clean_single_database "$host_addr" "$host_id"; then
      failed_hosts+=("$host_id")
      echo "[ERROR] Failed to clean ${host_id}, but continuing with other hosts"
    fi
  done
  
  echo "========================================"
  if [[ ${#failed_hosts[@]} -eq 0 ]]; then
    echo "[SUCCESS] All RDS database instances cleaned successfully"
    echo "[INFO] Next RHDH deployment will start with a clean state"
  else
    echo "[WARN] Some RDS hosts failed to clean: ${failed_hosts[*]}"
    echo "[INFO] Successfully cleaned $((${#rds_hosts[@]} - ${#failed_hosts[@]}))/${#rds_hosts[@]} RDS host(s)"
    return 1
  fi
}
