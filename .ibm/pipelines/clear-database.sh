#!/bin/bash

clear_database() {
  export POSTGRES_USER="$(echo -n "$RDS_USER" | base64 --decode)"
  export PGPASSWORD=$RDS_PASSWORD
  export POSTGRES_HOST=$RDS_1_HOST

  DATABASES=$(psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -Atc \
    "SELECT datname FROM pg_database WHERE datistemplate = false AND datname NOT IN ('postgres', 'rdsadmin');")

  for db in $DATABASES; do
    echo "Dropping database: $db"
    psql -h "$POSTGRES_HOST" -U "$POSTGRES_USER" -p "5432" -d postgres -c "DROP DATABASE \"$db\";"
  done
}
