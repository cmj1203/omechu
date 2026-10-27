#!/usr/bin/env bash
# 빈 Postgres(PostGIS 필요)에 Supabase 흉내 → 모든 마이그레이션 → tests/db/*.test.sql 을 차례로 돌려요.
# 쓰는 법: PGHOST=… PGUSER=… PGPASSWORD=… bash tests/db/run.sh   (DB 이름은 omechu_test, 매번 새로 만들어요)
set -euo pipefail
cd "$(dirname "$0")/../.."
DB=${TEST_DB:-omechu_test}
psql -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
export PGOPTIONS="-c client_min_messages=warning"
run() { psql -v ON_ERROR_STOP=1 -q -X -d "$DB" -f "$1" > /dev/null; }
run tests/db/supabase-stub.sql
for f in supabase/migrations/*.sql; do
  run "$f" || { echo "마이그레이션 실패: $f" >&2; exit 1; }
done
echo "마이그레이션 $(ls supabase/migrations/*.sql | wc -l)개 적용"
status=0
for t in tests/db/*.test.sql; do
  [ -e "$t" ] || continue
  if psql -v ON_ERROR_STOP=1 -q -X -d "$DB" -f "$t" > /dev/null; then echo "통과: $t"; else echo "실패: $t" >&2; status=1; fi
done
exit $status
