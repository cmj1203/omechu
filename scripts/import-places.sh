#!/usr/bin/env bash
# OpenStreetMap 한국 지도에서 식당·카페·술집만 골라 Supabase places 표를 새로 채워요. 한 달에 한 번쯤 다시 실행하면 돼요.
# 필요한 것: brew install osmium-tool, supabase CLI 로그인과 link, .env.local 의 SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY
set -euo pipefail
cd "$(dirname "$0")/.."
set -a
. ./.env.local
set +a

WORK="${TMPDIR:-/tmp}/omechu-osm"
mkdir -p "$WORK"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

echo "1/4 한국 지도 내려받는 중..."
curl -fsSL -o "$WORK/south-korea-latest.osm.pbf" https://download.geofabrik.de/asia/south-korea-latest.osm.pbf

echo "2/4 식당·카페·술집만 고르는 중..."
osmium tags-filter "$WORK/south-korea-latest.osm.pbf" \
	nwr/amenity=restaurant,fast_food,cafe,bar,pub,food_court,ice_cream,biergarten \
	nwr/shop=bakery,pastry,confectionery \
	-o "$WORK/food.osm.pbf" --overwrite
osmium export "$WORK/food.osm.pbf" -f geojsonseq -a type,id -o "$WORK/food.geojsonseq" --overwrite

echo "3/4 DB에 올리는 중..."
python3 scripts/osm_to_places.py "$WORK/food.geojsonseq" "$STARTED_AT"

echo "4/4 지도에서 사라진 가게 지우는 중..."
supabase db query --linked "delete from public.places where imported_at < '$STARTED_AT'"
echo "끝났어요."
