#!/bin/bash

clear_database() {
  POSTGRES_USER="$(echo -n "$RDS_USER" | base64 --decode)"
  export POSTGRES_USER
  export PGPASSWORD=$RDS_PASSWORD
  export POSTGRES_HOST=$RDS_1_HOST

  echo "Starting database cleanup process..."

  # Get list of databases, handle potential connection errors
  DATABASES=$(psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -Atc \
    "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres', 'rdsadmin');" 2> /dev/null)

  if [ $? -ne 0 ]; then
    echo "Warning: Failed to connect to database or retrieve database list"
    return 1
  fi

  if [ -z "$DATABASES" ]; then
    echo "No databases found to drop"
    return 0
  fi

  echo "Found databases to drop: $(echo "$DATABASES" | tr '\n' ' ')"

  for db in $DATABASES; do
    echo "Attempting to drop database: $db"

    # Use IF EXISTS to avoid errors if database doesn't exist
    # Capture both stdout and stderr, but don't let errors stop the script
    if psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -c "DROP DATABASE IF EXISTS \"$db\";" 2>&1; then
      echo "Successfully dropped database: $db"
    else
      echo "Warning: Failed to drop database $db, but continuing with cleanup"
    fi
  done

  echo "Database cleanup process completed"
}
