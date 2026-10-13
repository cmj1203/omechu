#!/usr/bin/env bash
# 서울시 본청 업무추진비(서울 열린데이터광장 odExpense)에서 최근 2년 식사 자리를 가게별로 모아 Supabase official_picks 표를 새로 채워요.
# 가게 좌표는 상가(상권)정보에서 찾아요. 같은 작업 안에서 import-sbiz-places.sh 가 받아 둔 파일이 있으면 그걸 써요.
# 필요한 것: python3(3.11 이상), SEOUL_OPENAPI_KEY · SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY (.env.local 이나 환경 변수)
# DRY_RUN=1 bash scripts/import-official-picks.sh 로 돌리면 결과만 세고 DB는 건드리지 않아요.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f ./.env.local ]; then
	set -a
	. ./.env.local
	set +a
fi

: "${SEOUL_OPENAPI_KEY:?SEOUL_OPENAPI_KEY 가 필요해요 (서울 열린데이터광장 인증키)}"
: "${SUPABASE_URL:?SUPABASE_URL 이 필요해요}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY 가 필요해요}"

ZIP="${TMPDIR:-/tmp}/omechu-sbiz/sbiz.zip"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

if [ ! -s "$ZIP" ]; then
	echo "1/3 가게 좌표용 상가정보 내려받는 중..."
	DOWNLOAD_ONLY=1 bash scripts/import-sbiz-places.sh
fi

if [ "${DRY_RUN:-}" = "1" ]; then
	echo "2/3 (시험) 업무추진비 받아 가게별로 모으기만 해요..."
	python3 scripts/official_picks.py "$ZIP" "$STARTED_AT"
	echo "시험이라 DB는 건드리지 않았어요."
	exit 0
fi

count_picks() {
	curl -fsS -o /dev/null -D - "$SUPABASE_URL/rest/v1/official_picks?select=place_key$1" \
		-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
		-H "Prefer: count=exact" -H "Range: 0-0" \
		| tr -d '\r' | awk -F/ 'tolower($1) ~ /^content-range:/ {print $2}'
}

BEFORE="$(count_picks "")"
echo "2/3 업무추진비 받아 가게별로 모아 올리는 중... (지금 ${BEFORE}곳)"
python3 scripts/official_picks.py "$ZIP" "$STARTED_AT"

# 받은 데이터가 이상해서 새로 올린 곳이 절반도 안 되면, 멀쩡한 목록을 지우지 않도록 여기서 멈춰요.
FRESH="$(count_picks "&imported_at=gte.$STARTED_AT")"
if ! [[ "$BEFORE" =~ ^[0-9]+$ && "$FRESH" =~ ^[0-9]+$ ]]; then
	echo "가게 수를 읽지 못해서(전 '${BEFORE}', 새로 '${FRESH}') 지우기를 건너뛰어요." >&2
	exit 1
fi
if [ "$FRESH" -eq 0 ] || [ $((FRESH * 2)) -lt "$BEFORE" ]; then
	echo "새로 올린 곳이 ${FRESH}곳뿐이라(전에는 ${BEFORE}곳) 지우기를 건너뛰어요." >&2
	exit 1
fi

echo "3/3 이번에 안 나온 곳 지우는 중... (새로 올린 곳 ${FRESH}곳)"
curl -fsS -X DELETE "$SUPABASE_URL/rest/v1/official_picks?imported_at=lt.$STARTED_AT" \
	-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
	-H "Prefer: return=minimal"
echo "끝났어요."
