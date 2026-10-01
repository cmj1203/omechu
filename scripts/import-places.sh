#!/usr/bin/env bash
# OpenStreetMap 한국 지도에서 식당·카페·술집만 골라 Supabase places 표를 새로 채워요.
# GitHub Actions(.github/workflows/refresh-places.yml)가 매달 자동으로 실행하고, 직접 돌려도 돼요.
# 필요한 것: osmium-tool, SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY (.env.local 이나 환경 변수)
# DRY_RUN=1 bash scripts/import-places.sh 로 돌리면 내려받고 고르기까지만 하고 DB는 건드리지 않아요.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f ./.env.local ]; then
	set -a
	. ./.env.local
	set +a
fi

# 설정이 빠졌으면 큰 지도 파일을 내려받기 전에 바로 멈춰요.
if [ "${DRY_RUN:-}" != "1" ]; then
	: "${SUPABASE_URL:?SUPABASE_URL 이 필요해요}"
	: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY 가 필요해요}"
fi

WORK="${TMPDIR:-/tmp}/omechu-osm"
mkdir -p "$WORK"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

BASE_URL=https://download.geofabrik.de/asia/south-korea
# Geofabrik의 '-latest' 주소는 날짜 붙은 파일로 넘겨주는데, GitHub 러너에서는 같은 주소로 계속 넘겨서(무한 이동) 받을 수 없어요.
# 그래서 넘겨줄 주소에 날짜가 있으면 그걸 쓰고, 없으면 오늘부터 하루씩 거슬러 날짜 붙은 파일을 찾아요.
# 아직 없는 날짜는 응답 없이 기다리기도 해서, 한 번에 30초까지만 기다려요.
find_pbf_url() {
	local next days stamp code
	next="$(curl -sS -o /dev/null --max-time 30 -w '%{redirect_url}' "$BASE_URL-latest.osm.pbf" || true)"
	if [[ "$next" =~ -[0-9]{6}\.osm\.pbf/?$ ]]; then
		echo "${next%/}"
		return
	fi
	for days in 0 1 2 3 4 5 6 7; do
		stamp="$(python3 -c "import datetime as d; print((d.datetime.now(d.timezone.utc) - d.timedelta(days=$days)).strftime('%y%m%d'))")"
		code="$(curl -sS -o /dev/null -r 0-0 --max-redirs 0 --max-time 30 -w '%{http_code}' "$BASE_URL-$stamp.osm.pbf" || true)"
		if [ "$code" = "200" ] || [ "$code" = "206" ]; then
			echo "$BASE_URL-$stamp.osm.pbf"
			return
		fi
	done
}
PBF_URL="$(find_pbf_url)"
: "${PBF_URL:?최근 8일 안의 한국 지도 파일을 찾지 못했어요}"

echo "1/4 한국 지도 내려받는 중... (${PBF_URL##*/})"
curl -fsSL --retry 3 --retry-delay 30 --retry-all-errors -o "$WORK/south-korea-latest.osm.pbf" "$PBF_URL"

echo "2/4 식당·카페·술집만 고르는 중..."
osmium tags-filter "$WORK/south-korea-latest.osm.pbf" \
	nwr/amenity=restaurant,fast_food,cafe,bar,pub,food_court,ice_cream,biergarten \
	nwr/shop=bakery,pastry,confectionery \
	-o "$WORK/food.osm.pbf" --overwrite
osmium export "$WORK/food.osm.pbf" -f geojsonseq -a type,id -o "$WORK/food.geojsonseq" --overwrite

if [ "${DRY_RUN:-}" = "1" ]; then
	echo "3/4 (시험) 올릴 가게 수만 세요..."
	python3 scripts/osm_to_places.py "$WORK/food.geojsonseq" "$STARTED_AT"
	echo "시험이라 DB는 건드리지 않았어요."
	exit 0
fi

count_places() {
	curl -fsS -o /dev/null -D - "$SUPABASE_URL/rest/v1/places?select=osm_id$1" \
		-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
		-H "Prefer: count=exact" -H "Range: 0-0" \
		| tr -d '\r' | awk -F/ 'tolower($1) ~ /^content-range:/ {print $2}'
}

BEFORE="$(count_places "")"
echo "3/4 DB에 올리는 중... (지금 ${BEFORE}곳)"
python3 scripts/osm_to_places.py "$WORK/food.geojsonseq" "$STARTED_AT"

# 지도 파일이 잘못 받아져 새로 올린 가게가 너무 적으면, 멀쩡한 가게를 지우지 않도록 여기서 멈춰요.
FRESH="$(count_places "&imported_at=gte.$STARTED_AT")"
# 가게 수를 숫자로 읽지 못하면 아래 비교가 그냥 넘어가 버려서, 그때도 지우지 않고 멈춰요.
if ! [[ "$BEFORE" =~ ^[0-9]+$ && "$FRESH" =~ ^[0-9]+$ ]]; then
	echo "가게 수를 읽지 못해서(전 '${BEFORE}', 새로 '${FRESH}') 지우기를 건너뛰어요." >&2
	exit 1
fi
if [ "$FRESH" -lt $((BEFORE * 8 / 10)) ]; then
	echo "새로 올린 가게가 ${FRESH}곳뿐이라(전에는 ${BEFORE}곳) 지우기를 건너뛰어요." >&2
	exit 1
fi

echo "4/4 지도에서 사라진 가게 지우는 중... (새로 올린 가게 ${FRESH}곳)"
curl -fsS -X DELETE "$SUPABASE_URL/rest/v1/places?imported_at=lt.$STARTED_AT" \
	-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
	-H "Prefer: return=minimal"
echo "끝났어요."
