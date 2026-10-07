#!/usr/bin/env bash
# 소상공인시장진흥공단 상가(상권)정보(공공데이터포털, 분기마다 새로 나옴)에서 음식점만 골라 Supabase places 표에 더해요.
# OpenStreetMap 에 없는 지방 식당이 많아서 넣어요. OpenStreetMap 가게와 같은 가게(가까운 곳의 같은 이름)는 빼고 올려요.
# 필요한 것: python3, unzip, SUPABASE_URL · SUPABASE_SERVICE_ROLE_KEY (.env.local 이나 환경 변수)
# DRY_RUN=1 bash scripts/import-sbiz-places.sh 로 돌리면 내려받고 고르기까지만 하고 DB는 건드리지 않아요.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f ./.env.local ]; then
	set -a
	. ./.env.local
	set +a
fi

: "${SUPABASE_URL:?SUPABASE_URL 이 필요해요}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY 가 필요해요}"

WORK="${TMPDIR:-/tmp}/omechu-sbiz"
mkdir -p "$WORK"
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 공공데이터포털은 파일을 새로 올릴 때마다 파일 번호가 바뀌어서, 데이터 화면에서 지금 번호를 찾아 받아요.
PAGE_URL=https://www.data.go.kr/data/15083033/fileData.do
DETAIL_PK="$(curl -fsS --max-time 60 "$PAGE_URL" | grep -o "fn_fileDataDown('15083033', 'uddi:[0-9a-f-]*'" | head -1 | grep -o 'uddi:[0-9a-f-]*' || true)"
: "${DETAIL_PK:?상가정보 데이터 화면에서 파일을 찾지 못했어요}"
FILE_ID="$(curl -fsS --max-time 60 -X POST "https://www.data.go.kr/tcs/dss/selectFileDataDownload.do" \
	-H "X-Requested-With: XMLHttpRequest" -H "Referer: $PAGE_URL" \
	--data-urlencode "publicDataDetailPk=$DETAIL_PK" --data "publicDataPk=15083033&atchFileId=&fileDetailSn=1&publicDataTyCode=PR0051" \
	| python3 -c "import json, sys; data = json.load(sys.stdin); print(data['atchFileId'] if data.get('status') else '')")"
: "${FILE_ID:?상가정보 파일 번호를 받지 못했어요}"

# zip 안 파일 이름이 옛 한글 인코딩(cp949)이라 unzip 으로 풀면 깨져서, 풀지 않고 파이썬이 zip 을 바로 읽어요.
echo "1/3 상가정보 내려받는 중... ($FILE_ID)"
curl -fsSL --retry 3 --retry-delay 30 --retry-all-errors -o "$WORK/sbiz.zip" \
	"https://www.data.go.kr/cmm/cmm/fileDownload.do?atchFileId=$FILE_ID&fileDetailSn=1"

if [ "${DRY_RUN:-}" = "1" ]; then
	echo "2/3 (시험) 메뉴에 맞는 음식점만 골라 가게 수만 세요..."
	python3 scripts/sbiz_to_places.py "$WORK/sbiz.zip" "$STARTED_AT"
	echo "시험이라 DB는 건드리지 않았어요."
	exit 0
fi

count_places() {
	curl -fsS -o /dev/null -D - "$SUPABASE_URL/rest/v1/places?select=osm_id&source=eq.sbiz$1" \
		-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
		-H "Prefer: count=exact" -H "Range: 0-0" \
		| tr -d '\r' | awk -F/ 'tolower($1) ~ /^content-range:/ {print $2}'
}

BEFORE="$(count_places "")"
echo "2/3 메뉴에 맞는 음식점만 골라(OpenStreetMap 에 있는 가게는 빼고) DB에 올리는 중... (지금 상가정보 가게 ${BEFORE}곳)"
python3 scripts/sbiz_to_places.py "$WORK/sbiz.zip" "$STARTED_AT"

# 파일이 잘못 받아져 새로 올린 가게가 너무 적으면, 멀쩡한 가게를 지우지 않도록 여기서 멈춰요.
FRESH="$(count_places "&imported_at=gte.$STARTED_AT")"
if ! [[ "$BEFORE" =~ ^[0-9]+$ && "$FRESH" =~ ^[0-9]+$ ]]; then
	echo "가게 수를 읽지 못해서(전 '${BEFORE}', 새로 '${FRESH}') 지우기를 건너뛰어요." >&2
	exit 1
fi
if [ "$FRESH" -lt $((BEFORE * 8 / 10)) ]; then
	echo "새로 올린 가게가 ${FRESH}곳뿐이라(전에는 ${BEFORE}곳) 지우기를 건너뛰어요." >&2
	exit 1
fi

echo "3/3 문 닫은 가게 지우는 중... (새로 올린 가게 ${FRESH}곳)"
curl -fsS -X DELETE "$SUPABASE_URL/rest/v1/places?source=eq.sbiz&imported_at=lt.$STARTED_AT" \
	-H "apikey: $SUPABASE_SERVICE_ROLE_KEY" -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
	-H "Prefer: return=minimal"
echo "끝났어요."
