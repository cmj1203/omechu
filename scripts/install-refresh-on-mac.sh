#!/usr/bin/env bash
# scripts/refresh-on-mac.sh 를 매일 아침 6시에 깨우는 launchd 예약을 이 맥에 설치해요. 다시 돌리면 새 설정으로 바꿔요.
# GitHub Actions 예약(2일 새벽 3시)이 끝난 뒤 돌게 6시로 뒀어요. 그 시각에 맥이 자고 있었으면 깨어날 때 돌고, 꺼져 있었으면 다음 날 6시에 돌아요.
# 지우기: launchctl bootout "gui/$(id -u)/com.omechu.monthly-refresh" && rm ~/Library/LaunchAgents/com.omechu.monthly-refresh.plist
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL=com.omechu.monthly-refresh
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/omechu-monthly-refresh.log"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>/bin/bash</string>
		<string>$ROOT/scripts/refresh-on-mac.sh</string>
	</array>
	<key>EnvironmentVariables</key>
	<dict>
		<key>PATH</key>
		<string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
		<key>PYTHONUNBUFFERED</key>
		<string>1</string>
	</dict>
	<key>StartCalendarInterval</key>
	<dict>
		<key>Hour</key>
		<integer>6</integer>
		<key>Minute</key>
		<integer>0</integer>
	</dict>
	<key>StandardOutPath</key>
	<string>$LOG</string>
	<key>StandardErrorPath</key>
	<string>$LOG</string>
</dict>
</plist>
EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
echo "설치했어요: $PLIST (기록: $LOG)"
