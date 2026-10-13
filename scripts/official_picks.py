#!/usr/bin/env python3
"""서울시 본청 업무추진비 집행내역에서 식사 자리를 가게별로 모아 Supabase official_picks 표를 채워요.
import-official-picks.sh 가 실행해요.

사용법: python3 scripts/official_picks.py <상가정보.zip> <가져오기 시작 시각(ISO)>
환경 변수: SEOUL_OPENAPI_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DRY_RUN=1 이면 올리지 않고 결과만 세요
"""
import calendar
import collections
import csv
import datetime
import io
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

API_PAGE = 1000
RECENT_MONTHS = 24
MIN_VISITS = 2
# 다과·간식 구입이 대부분이라 맛집에서 빼는 업종 (구내식당·유흥 주점도 빼요)
SKIPPED_MIDDLE = {"비알코올", "구내식당·뷔페"}
SKIPPED_SUB = {"빵/도넛", "떡/한과", "아이스크림/빙수", "일반 유흥 주점", "무도 유흥 주점"}


def normalized(name):
    name = re.sub(r"\(주\)|㈜|주식회사|유한회사", "", name.lower())
    return re.sub(r"[\s()·.,'&\-_/]", "", name)


def address_number(main, sub):
    main, sub = main.strip(), sub.strip()
    return main + ("-" + sub if sub and sub != "0" else "")


def fetch_expenses(key):
    rows, start = [], 1
    while True:
        url = f"http://openapi.seoul.go.kr:8088/{urllib.parse.quote(key)}/json/odExpense/{start}/{start + API_PAGE - 1}/"
        with urllib.request.urlopen(url, timeout=120) as response:
            body = json.load(response)
        if "odExpense" not in body:
            raise RuntimeError("업무추진비를 받지 못했어요: " + json.dumps(body, ensure_ascii=False)[:300])
        page = body["odExpense"]
        if page.get("RESULT", {}).get("CODE") != "INFO-000":
            raise RuntimeError("업무추진비 API가 정상 결과를 반환하지 않았어요.")
        batch = page.get("row", [])
        expected = min(API_PAGE, page["list_total_count"] - start + 1)
        if expected <= 0 or len(batch) != expected:
            raise RuntimeError(f"업무추진비 {start}번째 페이지가 불완전해요. 기존 목록은 유지해요.")
        rows += batch
        if start + API_PAGE > page["list_total_count"]:
            return rows
        start += API_PAGE


def seoul_food_stores(zip_path):
    """상가정보에서 서울 음식점을 주소(도로명·지번)와 구별 이름으로 찾을 수 있게 모아요."""
    by_road, by_lot, by_name = collections.defaultdict(list), collections.defaultdict(list), collections.defaultdict(list)
    with zipfile.ZipFile(zip_path, metadata_encoding="cp949") as archive:
        info = next(item for item in archive.infolist() if item.filename.endswith(".csv") and "_서울_" in item.filename)
        rows = csv.reader(io.TextIOWrapper(archive.open(info), encoding="utf-8-sig"))
        col = {name: index for index, name in enumerate(next(rows))}
        for row in rows:
            middle, sub = row[col["상권업종중분류명"]].strip(), row[col["상권업종소분류명"]].strip()
            if row[col["상권업종대분류명"]].strip() != "음식" or middle in SKIPPED_MIDDLE or sub in SKIPPED_SUB:
                continue
            try:
                lat, lng = float(row[col["위도"]]), float(row[col["경도"]])
            except ValueError:
                continue
            gu = row[col["시군구명"]].strip()
            road = row[col["도로명"]].split()[-1:]
            number = address_number(row[col["건물본번지"]], row[col["건물부번지"]])
            store = {
                "place_key": "sb" + row[col["상가업소번호"]],
                "name": " ".join(part for part in (row[col["상호명"]].strip(), row[col["지점명"]].strip()) if part),
                "brand": normalized(row[col["상호명"]]),
                "address": " ".join(road + [number]) if road else None,
                "category": sub,
                "lat": round(lat, 7),
                "lng": round(lng, 7),
            }
            store["full"] = normalized(store["name"])
            if road:
                by_road[(gu, road[0], number)].append(store)
            lot = address_number(row[col["지번본번지"]], row[col["지번부번지"]])
            by_lot[(gu, row[col["법정동명"]].strip(), lot)].append(store)
            by_name[(gu, store["brand"])].append(store)
    return by_road, by_lot, by_name


def same_name(key, store):
    """업무추진비 장소 이름과 가게 이름이 같은 가게를 가리키는지 (지점명이 붙거나 빠져도 같게 봐요)"""
    if len(store["brand"]) < 2 or len(key) < 2:
        return key == store["full"]
    return store["brand"] in key or key in store["full"]


def find_store(location, stores):
    """'잼배옥(중구 서소문동 64-4)' 같은 사용 장소를 상가정보 가게로 찾아요. 못 찾으면 None"""
    by_road, by_lot, by_name = stores
    match = re.match(r"^(.*)\s*\(([^()]*)\)\s*$", location.strip())
    if not match:
        return None
    key = normalized(match.group(1))
    parts = match.group(2).split()
    while parts and parts[0] in ("서울특별시", "서울시", "서울"):
        parts = parts[1:]
    if not key or len(parts) < 2 or not parts[0].endswith("구"):
        return None
    gu = parts[0]
    candidates = []
    if len(parts) >= 3:
        number = parts[2].split(",")[0]
        candidates = by_road.get((gu, parts[1], number)) or by_lot.get((gu, parts[1], number)) or []
    else:
        candidates = by_name.get((gu, key), [])
    named = {store["place_key"]: store for store in candidates if same_name(key, store)}
    if len(named) == 1:
        return next(iter(named.values()))
    return None


def people(target):
    """'공동주택과장 외 6명' → 7, '기획관 등 4명' → 4"""
    found = re.search(r"(외)?\s*(\d+)\s*명", target or "")
    if not found:
        return None
    count = int(found.group(2)) + (1 if found.group(1) else 0)
    return count if count > 0 else None


def build_picks(expenses, stores, imported_at, today):
    year, month_index = divmod(today.year * 12 + today.month - 1 - RECENT_MONTHS, 12)
    since = datetime.date(year, month_index + 1, min(today.day, calendar.monthrange(year, month_index + 1)[1]))
    counts = collections.Counter()
    visits = {}
    for row in expenses:
        try:
            when = datetime.datetime.strptime(row["EXEC_DT"].strip()[:16], "%Y-%m-%d %H:%M")
        except ValueError:
            counts["날짜 없음"] += 1
            continue
        if not since <= when.date() <= today:
            counts["기간 밖"] += 1
            continue
        purpose = row.get("EXEC_PURPOSE") or ""
        if (
            not re.search(r"간담|오찬|만찬|식사|중식|석식|조식|급식|도시락", purpose)
            or re.search(r"다과|커피|음료|물품|상품권|기념품|성금|조의금|축의금|격려금", purpose)
        ):
            counts["식사 목적 아님"] += 1
            continue
        counts["식사 대상"] += 1
        store = find_store(row.get("EXEC_LOC") or "", stores)
        if store is None:
            counts["가게 못 찾음"] += 1
            continue
        counts["가게 찾음"] += 1
        entry = visits.setdefault(store["place_key"], {"store": store, "rows": []})
        entry["rows"].append((when, row))
    picks = []
    for entry in visits.values():
        rows = entry["rows"]
        if len(rows) < MIN_VISITS:
            continue
        per_person = []
        for _, row in rows:
            amount, count = row.get("EXEC_AMOUNT"), people(row.get("TARGET_NM"))
            if count and str(amount).strip().isdigit():
                per_person.append(int(amount) / count)
        store = entry["store"]
        picks.append({
            "place_key": store["place_key"],
            "name": store["name"][:120],
            "address": store["address"],
            "category": store["category"],
            "lat": store["lat"],
            "lng": store["lng"],
            "visits": len(rows),
            "departments": len({row.get("DEPT_NM_FULL") or row.get("DEPT_NM") for _, row in rows}),
            "avg_per_person": round(sum(per_person) / len(per_person)) if per_person else None,
            "lunch_visits": sum(1 for when, _ in rows if 11 <= when.hour < 15),
            "dinner_visits": sum(1 for when, _ in rows if when.hour >= 17),
            "last_visit": max(when for when, _ in rows).date().isoformat(),
            "imported_at": imported_at,
        })
    counts["맛집"] = len(picks)
    return picks, counts


def upload(picks):
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    for start in range(0, len(picks), 1000):
        request = urllib.request.Request(
            os.environ["SUPABASE_URL"] + "/rest/v1/official_picks?on_conflict=place_key",
            data=json.dumps(picks[start:start + 1000], ensure_ascii=False).encode("utf-8"),
            method="POST",
            headers={
                "apikey": key,
                "Authorization": "Bearer " + key,
                "Content-Type": "application/json",
                "Prefer": "resolution=merge-duplicates,return=minimal",
            },
        )
        try:
            with urllib.request.urlopen(request, timeout=120):
                pass
        except urllib.error.HTTPError as error:
            raise RuntimeError("업로드 실패: HTTP " + str(error.code) + " " + error.read().decode("utf-8", "replace")[:300]) from error


def main():
    zip_path, imported_at = sys.argv[1], sys.argv[2]
    expenses = fetch_expenses(os.environ["SEOUL_OPENAPI_KEY"])
    print(f"업무추진비 {len(expenses):,}건 받음", flush=True)
    picks, counts = build_picks(expenses, seoul_food_stores(zip_path), imported_at, datetime.date.today())
    print(", ".join(f"{label} {count:,}" for label, count in counts.items()), flush=True)
    if os.environ.get("DRY_RUN") == "1":
        for pick in sorted(picks, key=lambda item: -item["visits"])[:10]:
            print(f"  {pick['visits']}번 {pick['name']} ({pick['address']}, {pick['category']})", flush=True)
        return
    upload(picks)
    print(f"완료: 맛집 {len(picks):,}곳", flush=True)


if __name__ == "__main__":
    main()
