#!/usr/bin/env bash
# Rebuild the local test database (port 55433) as a fresh copy of DEV.
#
#   bash scripts/local-test-db.sh
#
# Test suites empty transactions on whatever DATABASE_URL names; pointed at
# this copy (.env.test) they never touch DEV, and run with no network hop.
#   set -a; . ./.env.test; set +a; node scripts/regression.mjs <filters>
#
# Needs the private cluster at C:\Users\MSI\pgdata-phone-test (started with
# pg_ctl on port 55433) and .env.test (git-ignored) holding its URL. The dump
# holds DEV's real customer data, so it is deleted when the copy is made.
set -euo pipefail
B="/c/Program Files/PostgreSQL/18/bin"
cd "$(dirname "$0")/.."
LOCAL=$(sed -n 's/^DATABASE_URL=//p' .env.test)
DEV=$(sed -n 's/^DATABASE_URL=//p' .env | sed -E 's/-pooler//; s/&channel_binding=require//')
case "$LOCAL" in *localhost:55433*) ;; *) echo "Refusing: .env.test is not the local test database"; exit 1;; esac
ADMIN="${LOCAL%/*}/postgres"
DUMP=$(mktemp -d)/dev.sql
trap 'rm -rf "$(dirname "$DUMP")"' EXIT

"$B/pg_dump.exe" --no-owner --no-acl -f "$DUMP" "$DEV"
# Neon stores a column setting standard PostgreSQL does not know.
sed -i '/SET (pg_attver=/d' "$DUMP"
"$B/psql.exe" "$ADMIN" -q -c "drop database if exists phone_test" -c "create database phone_test"
"$B/psql.exe" "$LOCAL" -q -v ON_ERROR_STOP=1 -f "$DUMP"
"$B/psql.exe" "$LOCAL" -At -c "select 'local copy of ' || name || ': ' || (select count(*) from item) || ' items' from company"
