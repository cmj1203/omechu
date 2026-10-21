#!/usr/bin/env bash
# 이미 가져온 가게에서만 폐업 여부를 대조하므로 상가정보 가져오기가 끝난 뒤 실행해요.
# 경계에서 응답 형식을 검사하려고 좌표 변환과 함께 pydantic을 사용해요.
# 설치: python3 -m pip install pyproj pydantic
# DRY_RUN=1 이면 기존 검색 제외 목록을 보존하고 판정 결과만 출력해요.
set -euo pipefail
cd "$(dirname "$0")/.."
if [ -f ./.env.local ]; then
	set -a
	. ./.env.local
	set +a
fi

: "${SUPABASE_URL:?SUPABASE_URL이 필요해요}"
: "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY가 필요해요}"
: "${SEOUL_OPENAPI_KEY:?카페·제과점도 대조하려면 SEOUL_OPENAPI_KEY가 필요해요}"

python3 scripts/closed_places.py
