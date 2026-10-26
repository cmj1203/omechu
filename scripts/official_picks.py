#!/usr/bin/env python3
"""서울시 본청·은평구·서대문구·행정안전부 업무추진비 집행내역에서 식사 자리를 가게별로 모아 Supabase official_picks 표를 채워요.
import-official-picks.sh 가 실행해요.

사용법: python3 scripts/official_picks.py <상가정보.zip> <가져오기 시작 시각(ISO)>
환경 변수: SEOUL_OPENAPI_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DRY_RUN=1 이면 올리지 않고 결과만 세요
"""
import calendar
import importlib
import multiprocessing
import queue as queue_module
import time
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

import expenses_busan
import expenses_daegu
import expenses_daejeon
import expenses_dobong
import expenses_gangnam
import expenses_gwanak
import expenses_gwangju
import expenses_junggu
import expenses_nowon
import expenses_seongnam
import expenses_yangcheon
import expenses_yongin
import local_expenses

API_PAGE = 1000
RECENT_MONTHS = 24
MIN_VISITS = 2
AGENCY_ORDER = ["서울시 본청", "은평구", "서대문구", "관악구", "강남구", "중구", "도봉구", "노원구", "양천구", "행정안전부", "부산광역시", "대구광역시", "대전광역시", "광주", "성남시", "용인시"]
# 구청 홈페이지에서 받는 구들이에요. 한 구 사이트가 막혀도 나머지 구는 올리려고, 실패한 구만 건너뛰어요.
DISTRICTS = [("관악구", expenses_gwanak), ("강남구", expenses_gangnam), ("중구", expenses_junggu),
             ("도봉구", expenses_dobong), ("노원구", expenses_nowon), ("양천구", expenses_yangcheon),
             ("부산광역시", expenses_busan), ("대구광역시", expenses_daegu), ("대전광역시", expenses_daejeon),
             ("광주", expenses_gwangju), ("성남시", expenses_seongnam), ("용인시", expenses_yongin)]
# 다과·간식 구입이 대부분이라 맛집에서 빼는 업종 (구내식당·유흥 주점도 빼요)
SKIPPED_MIDDLE = {"비알코올", "구내식당·뷔페"}
# 상가정보에서 가게를 모을 시도 파일. 서울·세종 말고는 그 시도의 업무추진비를 붙일 때 더해요.
STORE_FILES = ("_서울_", "_세종_", "_부산_", "_대구_", "_대전_", "_전남광주_", "_경기_")
PLAIN_SIDO = {"서울특별시", "세종특별자치시"}
SKIPPED_SUB = {"빵/도넛", "떡/한과", "아이스크림/빙수", "일반 유흥 주점", "무도 유흥 주점"}
# 업종은 분식으로 올라 있어도 실제로는 기관 직원 매점·구내 식당인 곳('대전광역시청직원복지회')은 이름으로 빼요.
SKIPPED_NAME_WORDS = ("복지회",)


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


def food_stores(zip_path):
    """상가정보에서 서울·세종 음식점을 주소(도로명·지번)와 구(시)별 이름으로 찾을 수 있게 모아요. 세종은 행정안전부 기록용이에요."""
    by_road, by_lot, by_name, by_full = (collections.defaultdict(list) for _ in range(4))
    with zipfile.ZipFile(zip_path, metadata_encoding="cp949") as archive:
        infos = [item for item in archive.infolist() if item.filename.endswith(".csv") and any(part in item.filename for part in STORE_FILES)]
        for info in infos:
            rows = csv.reader(io.TextIOWrapper(archive.open(info), encoding="utf-8-sig"))
            col = {name: index for index, name in enumerate(next(rows))}
            for row in rows:
                middle, sub = row[col["상권업종중분류명"]].strip(), row[col["상권업종소분류명"]].strip()
                if row[col["상권업종대분류명"]].strip() != "음식" or middle in SKIPPED_MIDDLE or sub in SKIPPED_SUB:
                    continue
                if any(word in row[col["상호명"]] for word in SKIPPED_NAME_WORDS):
                    continue
                try:
                    lat, lng = float(row[col["위도"]]), float(row[col["경도"]])
                except ValueError:
                    continue
                gu = row[col["시군구명"]].strip()
                sido = row[col["시도명"]].strip()
                # 서울·세종은 원래대로 구 이름만 쓰고, 다른 시도는 '부산광역시 중구'처럼 앞에 붙여 다른 도시의 같은 구 이름과 섞이지 않게 해요.
                if sido not in PLAIN_SIDO:
                    gu = sido + " " + gu
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
                by_full[(gu, store["full"])].append(store)
    return by_road, by_lot, by_name, by_full


def same_name(key, store):
    """업무추진비 장소 이름과 가게 이름이 같은 가게를 가리키는지 (지점명이 붙거나 빠져도 같게 봐요)"""
    if len(store["brand"]) < 2 or len(key) < 2:
        return key == store["full"]
    return store["brand"] in key or key in store["full"]


def find_store(location, stores):
    """'잼배옥(중구 서소문동 64-4)' 같은 사용 장소를 상가정보 가게로 찾아요. 못 찾으면 None"""
    by_road, by_lot, by_name, _ = stores
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


def window_start(today):
    year, month_index = divmod(today.year * 12 + today.month - 1 - RECENT_MONTHS, 12)
    return datetime.date(year, month_index + 1, min(today.day, calendar.monthrange(year, month_index + 1)[1]))


def seoul_records(expenses):
    """서울시 본청 API 줄을 local_expenses.py 와 같은 모양의 기록으로 바꿔요. 사용 장소에 주소가 있어서 주소로 찾아요."""
    records = []
    for row in expenses:
        try:
            when = datetime.datetime.strptime(row["EXEC_DT"].strip()[:16], "%Y-%m-%d %H:%M")
        except ValueError:
            when = None
        amount = str(row.get("EXEC_AMOUNT") or "").strip()
        records.append({
            "agency": "서울시 본청",
            "when": when,
            "has_time": True,
            "name": None,
            "location": row.get("EXEC_LOC") or "",
            "gus": None,
            "purpose": row.get("EXEC_PURPOSE") or "",
            "meal": None,
            "amount": int(amount) if amount.isdigit() else None,
            "people": people(row.get("TARGET_NM")),
            "dept": "서울시 본청 " + (row.get("DEPT_NM_FULL") or row.get("DEPT_NM") or ""),
        })
    return records


def find_by_name(name, gus, stores):
    """주소 없이 가게 이름만 있을 때, 정해진 지역(구·시) 안에서 하나로 정해지는 가게만 찾아요.
    1) 이름 전체(상호+지점명)가 같은 가게 2) 마지막 낱말이 '○○점'이면 떼고 상호로 찾되,
    지점명까지 같은 가게나 지점명 없는 가게가 하나뿐일 때만 이어요. 다른 지점이나 짧은 이름('황제보쌈'→'황제')에는 잇지 않아요."""
    if "," in name:
        return None
    key = normalized(name)
    if len(key) < 2:
        return None
    by_name, by_full = stores[2], stores[3]
    exact = {store["place_key"]: store for gu in gus for store in by_full.get((gu, key), []) + by_name.get((gu, key), [])}
    if exact:
        return next(iter(exact.values())) if len(exact) == 1 else None
    tokens = name.split()
    if len(tokens) < 2 or not tokens[-1].endswith("점"):
        return None
    # 띄어쓰기로 나뉜 마지막 낱말이 '○○점'이면 지점명으로 보고 떼요. '풍년닭도리탕 신촌점'은 '풍년닭도리탕'으로만 찾아요.
    brand = {store["place_key"]: store for gu in gus for store in by_name.get((gu, normalized(" ".join(tokens[:-1]))), [])}
    same_branch = [store for store in brand.values() if store["full"] == key]
    if len(same_branch) == 1:
        return same_branch[0]
    # 찾는 지역이 여러 곳(행정안전부: 세종·종로)이면 다른 동네 같은 상호일 수 있어서, 지점명까지 같을 때만 이어요.
    no_branch = [store for store in brand.values() if store["full"] == store["brand"]]
    return no_branch[0] if len(no_branch) == 1 and not same_branch and len(gus) == 1 else None


def region_gus(gus, all_gus):
    """기록의 지역이 '부산광역시'·'경기도 성남시'처럼 시 단위면, 그 이름으로 시작하는 구를 모두 찾는 곳으로 넓혀요."""
    found = []
    for gu in gus:
        found += [name for name in all_gus if name == gu or name.startswith(gu + " ")] or [gu]
    return found


def is_meal(record):
    purpose = record["purpose"]
    if re.search(r"다과|커피|음료|물품|상품권|기념품|성금|조의금|축의금|격려금", purpose):
        return False
    if record["meal"] is not None:
        return record["meal"]
    return bool(re.search(r"간담|오찬|만찬|식사|중식|석식|조식|급식|도시락", purpose))


def build_picks(records, stores, imported_at, today):
    since = window_start(today)
    counts = collections.Counter()
    visits = {}
    all_gus = {gu for gu, _ in stores[2]}
    expanded = {}
    for record in records:
        when = record["when"]
        if when is None:
            counts["날짜 없음"] += 1
            continue
        if not since <= when.date() <= today:
            counts["기간 밖"] += 1
            continue
        if not is_meal(record):
            counts["식사 목적 아님"] += 1
            continue
        counts["식사 대상"] += 1
        if record["gus"] is None:
            store = find_store(record["location"], stores)
        else:
            key = tuple(record["gus"])
            if key not in expanded:
                expanded[key] = region_gus(record["gus"], all_gus)
            store = find_by_name(record["name"], expanded[key], stores)
        if store is None:
            counts["가게 못 찾음"] += 1
            continue
        counts["가게 찾음"] += 1
        counts[record["agency"] + " 가게 찾음"] += 1
        visits.setdefault(store["place_key"], {"store": store, "records": []})["records"].append(record)
    picks = []
    for entry in visits.values():
        found = entry["records"]
        if len(found) < MIN_VISITS:
            continue
        per_person = [record["amount"] / record["people"] for record in found if record["amount"] and record["people"]]
        timed = [record["when"] for record in found if record["has_time"]]
        store = entry["store"]
        picks.append({
            "place_key": store["place_key"],
            "name": store["name"][:120],
            "address": store["address"],
            "category": store["category"],
            "lat": store["lat"],
            "lng": store["lng"],
            "visits": len(found),
            "departments": len({record["dept"] for record in found}),
            "avg_per_person": round(sum(per_person) / len(per_person)) if per_person else None,
            "lunch_visits": sum(1 for when in timed if 11 <= when.hour < 15),
            "dinner_visits": sum(1 for when in timed if when.hour >= 17),
            "last_visit": max(record["when"] for record in found).date().isoformat(),
            "agencies": ", ".join(sorted({record["agency"] for record in found}, key=AGENCY_ORDER.index)),
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


# 구청 서버 하나가 응답을 끌면 전체가 몇 시간씩 멈춰서, 구마다 따로 된 프로세스로 동시에 받고 시간 제한을 넘으면 꺼요.
DISTRICT_TIMEOUT = 40 * 60


def district_worker(module_name, since, today, queue):
    try:
        queue.put(("ok", importlib.import_module(module_name).fetch_records(since, today)))
    except (RuntimeError, OSError) as error:
        queue.put(("error", str(error)))


def district_records(since, today):
    context = multiprocessing.get_context("spawn")
    jobs = []
    for name, module in DISTRICTS:
        queue = context.Queue()
        process = context.Process(target=district_worker, args=(module.__name__, since, today, queue), daemon=True)
        process.start()
        jobs.append((name, process, queue))
        print(f"{name} 업무추진비 받기 시작", flush=True)
    deadline = time.monotonic() + DISTRICT_TIMEOUT
    records = []
    for name, process, queue in jobs:
        try:
            status, value = queue.get(timeout=max(1, deadline - time.monotonic()))
        except queue_module.Empty:
            status, value = "error", f"{DISTRICT_TIMEOUT // 60}분 안에 끝나지 않았어요"
        process.join(5)
        if process.is_alive():
            process.terminate()
        if status == "ok":
            records += value
            print(f"{name} 업무추진비 {len(value):,}건 받음", flush=True)
        else:
            print(f"{name} 업무추진비를 건너뛰어요: {value}", flush=True)
    return records


def main():
    zip_path, imported_at = sys.argv[1], sys.argv[2]
    today = datetime.date.today()
    since = window_start(today)
    records = seoul_records(fetch_expenses(os.environ["SEOUL_OPENAPI_KEY"]))
    records += local_expenses.eunpyeong(since)
    records += local_expenses.seodaemun(since, today)
    records += local_expenses.mois(since)
    records += district_records(since, today)
    by_agency = collections.Counter(record["agency"] for record in records)
    print("업무추진비 받음: " + ", ".join(f"{agency} {by_agency[agency]:,}건" for agency in AGENCY_ORDER), flush=True)
    picks, counts = build_picks(records, food_stores(zip_path), imported_at, today)
    print(", ".join(f"{label} {count:,}" for label, count in counts.items()), flush=True)
    if os.environ.get("DRY_RUN") == "1":
        for pick in sorted(picks, key=lambda item: -item["visits"])[:10]:
            print(f"  {pick['visits']}번 {pick['name']} ({pick['address']}, {pick['category']})", flush=True)
        return
    upload(picks)
    print(f"완료: 맛집 {len(picks):,}곳", flush=True)


if __name__ == "__main__":
    main()
