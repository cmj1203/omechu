#!/usr/bin/env bash
# 공무원 맛집과 폐업 제외를 이 맥에서 매달 다시 받아요. launchd 가 매일 아침 깨워요(scripts/install-refresh-on-mac.sh 로 설치).
# GitHub 러너에서는 전국 인허가가 한 작업 한도(360분) 안에 끝나지 않고, 공무원 맛집은 기관이 빠져요(11-05 시험 실행).
# 매달 2일부터, 이번 달 성공 기록이 없는 단계만 돌아요. 맥이 꺼져 있었거나 실패하면 성공할 때까지 다음 날 6시에 다시 해요.
# 필요한 것: uv, .env.local (SEOUL_OPENAPI_KEY, DATA_GO_KR_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

STATE="$HOME/Library/Application Support/omechu"
MONTH="$(date +%Y-%m)"

if [ "$(date +%e)" -lt 2 ]; then
	exit 0
fi
is_done() {
	[ "$(cat "$STATE/$1-done" 2>/dev/null)" = "$MONTH" ]
}
if is_done official-picks && is_done closed-places; then
	echo "$(date '+%F %T') $MONTH 새로고침은 이미 끝났어요."
	exit 0
fi

notify() {
	osascript -e "display notification \"$1\" with title \"오메추 새로고침\"" || true
}

echo "$(date '+%F %T') $MONTH 새로고침을 시작해요."
mkdir -p "$STATE"
VENV="$STATE/venv"
if ! uv venv --quiet --allow-existing "$VENV" || ! uv pip install --quiet --python "$VENV/bin/python" pyproj pydantic xlrd; then
	echo "$(date '+%F %T') 파이썬 환경을 만들지 못했어요. 내일 다시 해요."
	notify "파이썬 환경을 만들지 못했어요"
	exit 1
fi
export PATH="$VENV/bin:$PATH"

# 지난달 상가정보 파일로 공무원 맛집 가게를 찾지 않게 지워요. import-official-picks.sh 가 새로 받아요.
rm -f "${TMPDIR:-/tmp}/omechu-sbiz/sbiz.zip"

failed=""
# 잠자기로 끊기지 않게 caffeinate 로 돌려요. 한쪽이 실패해도 다른 쪽은 돌고, 이미 성공한 쪽은 다시 돌지 않아요.
run_step() {
	if is_done "$1"; then
		return
	fi
	if caffeinate -i bash "scripts/$3"; then
		echo "$MONTH" > "$STATE/$1-done"
	else
		failed="${failed:+$failed, }$2"
	fi
}
run_step official-picks "공무원 맛집" import-official-picks.sh
run_step closed-places "폐업 제외" import-closed-places.sh

if [ -n "$failed" ]; then
	echo "$(date '+%F %T') 실패: $failed. 내일 다시 해요."
	notify "실패: $failed. 내일 다시 해요"
	exit 1
fi
echo "$(date '+%F %T') $MONTH 새로고침이 끝났어요."
notify "공무원 맛집과 폐업 제외를 새로 받았어요"
