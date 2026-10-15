#!/usr/bin/env python3
"""상가(상권)정보 zip 에서 메뉴 검색어에 걸리는 음식점만 골라 Supabase places 표에 넣어요. import-sbiz-places.sh 가 실행해요.

사용법: python3 scripts/sbiz_to_places.py <상가정보.zip> <가져오기 시작 시각(ISO)>
환경 변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DRY_RUN=1 이면 올리지 않고 가게 수만 세요
"""
import csv
import io
import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
import zipfile

BATCH_SIZE = 2000
SAME_PLACE_METERS = 150
# 추천에 안 맞는 곳(회사 구내식당, 유흥 주점)은 빼요.
SKIPPED_CATEGORIES = {("구내식당·뷔페", "구내식당"), ("주점", "일반 유흥 주점"), ("주점", "무도 유흥 주점")}
# 음식 업종으로 올라온 어린이집·단체·투자조합도 빼요. '직장어린이집'의 '장어', '대한민국수호…'의 '국수'처럼 메뉴 검색어에 걸려서 식당처럼 나왔어요.
# 협회·연합회·위원회는 이름이 그 말(또는 '…지부', '…지회' 같은 꼬리)로 끝날 때만 빼요. '수협회센터', '…한우협회고금녹색한우마을' 같은 가게는 남아요.
SKIPPED_NAME = re.compile(r"어린이집|투자조합|신기술|노동조합|사주조합|합자조합|(협회|연합회|위원회)(.*(지부|지회|지회사|부녀회|봉사단|구조대사))?$")
CUISINES = {"한식": "korean", "중식": "chinese", "일식": "japanese", "서양식": "western", "동남아시아": "asian"}
# 소분류별 가게 종류(OpenStreetMap 의 amenity·shop·cuisine 과 같은 말로 맞춰서, 식당 검색이 그대로 쓰게 해요)
SUBCATEGORIES = {
    "카페": ("cafe", None, None),
    "빵/도넛": (None, "bakery", None),
    "떡/한과": (None, "confectionery", None),
    "아이스크림/빙수": ("ice_cream", None, None),
    "피자": ("fast_food", None, "pizza"),
    "버거": ("fast_food", None, "burger"),
    "베트남식 전문": ("restaurant", None, "vietnamese"),
}


def request(method, path, body=None, headers=None):
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    req = urllib.request.Request(
        os.environ["SUPABASE_URL"] + path,
        data=None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8"),
        method=method,
        headers={"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json", **(headers or {})},
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"{method} {path.split('?')[0]} 실패: HTTP {error.code} " + error.read().decode("utf-8", "replace")[:300]) from error


def menu_pattern():
    """메뉴 검색어 정규식과, 메뉴에 이어 둔 업종('중분류/소분류') 모음을 돌려줘요."""
    menus = json.loads(request("GET", "/rest/v1/menus?select=name,search_terms,categories,broad_categories"))
    terms, categories = set(), set()
    for menu in menus:
        categories.update(menu["categories"] + menu["broad_categories"])
        for term in menu["search_terms"] or [menu["name"]]:
            # 식당 검색(searchTerms)과 똑같이 특수문자를 지워요.
            term = re.sub(r'[\\^$.|?*+()\[\]{}"%_]', "", term).strip().lower()
            if term:
                terms.add(term)
    return re.compile("|".join(re.escape(term) for term in sorted(terms, key=len, reverse=True))), categories


def normalized(name):
    return re.sub(r"[\s()·.,'&-]|본점$", "", name.lower())


def osm_places_by_cell():
    """OpenStreetMap 가게를 0.01도(약 1km) 칸별로 모아요. 같은 가게를 두 번 올리지 않으려고 써요."""
    # offset 으로 넘기면 뒤로 갈수록 느려져 DB 시간 제한에 걸려서, 마지막으로 읽은 osm_id 다음부터 읽어요.
    cells, last_id = {}, ""
    while True:
        after = "&osm_id=gt." + urllib.parse.quote(last_id) if last_id else ""
        rows = json.loads(request("GET", f"/rest/v1/places?select=osm_id,name,lat,lng&source=eq.osm&order=osm_id&limit=1000{after}"))
        for row in rows:
            cells.setdefault((int(row["lat"] * 100), int(row["lng"] * 100)), []).append((normalized(row["name"]), row["lat"], row["lng"]))
        if len(rows) < 1000:
            return cells
        last_id = rows[-1]["osm_id"]


def meters(lat1, lng1, lat2, lng2):
    dy = (lat2 - lat1) * 111_000
    dx = (lng2 - lng1) * 111_000 * math.cos(math.radians(lat1))
    return math.hypot(dx, dy)


def in_osm(cells, name, lat, lng):
    key = normalized(name)
    cy, cx = int(lat * 100), int(lng * 100)
    for y in (cy - 1, cy, cy + 1):
        for x in (cx - 1, cx, cx + 1):
            for osm_name, osm_lat, osm_lng in cells.get((y, x), ()):
                if (key in osm_name or osm_name in key) and min(len(key), len(osm_name)) >= 2 \
                        and meters(lat, lng, osm_lat, osm_lng) <= SAME_PLACE_METERS:
                    return True
    return False


def kind(middle, sub):
    if sub in SUBCATEGORIES:
        return SUBCATEGORIES[sub]
    if middle == "주점":
        return "bar", None, None
    return "restaurant", None, CUISINES.get(middle)


def read_places(zip_path, imported_at, pattern, menu_categories, cells, counts):
    with zipfile.ZipFile(zip_path, metadata_encoding="cp949") as archive:
        for info in archive.infolist():
            if not info.filename.endswith(".csv"):
                continue
            rows = csv.reader(io.TextIOWrapper(archive.open(info), encoding="utf-8-sig"))
            col = {name: index for index, name in enumerate(next(rows))}
            for row in rows:
                middle, sub = row[col["상권업종중분류명"]].strip(), row[col["상권업종소분류명"]].strip()
                if row[col["상권업종대분류명"]].strip() != "음식" or (middle, sub) in SKIPPED_CATEGORIES:
                    continue
                name = " ".join(part for part in (row[col["상호명"]].strip(), row[col["지점명"]].strip()) if part)
                category = middle + "/" + sub
                # 이름에 메뉴 글자가 있거나, 업종이 메뉴에 이어져 있으면(치킨, 중국집 등) 넣어요.
                if not name or SKIPPED_NAME.search(name) or not (pattern.search(name.lower()) or category in menu_categories):
                    continue
                try:
                    lat, lng = float(row[col["위도"]]), float(row[col["경도"]])
                except ValueError:
                    counts["좌표 없음"] += 1
                    continue
                if in_osm(cells, name, lat, lng):
                    counts["OpenStreetMap 에 있음"] += 1
                    continue
                amenity, shop, cuisine = kind(middle, sub)
                number = row[col["건물부번지"]].strip()
                road = row[col["도로명"]].split()[-1:] + [row[col["건물본번지"]].strip() + ("-" + number if number else "")]
                counts["올림"] += 1
                yield {
                    "osm_id": "sb" + row[col["상가업소번호"]],
                    "name": name[:120],
                    "amenity": amenity,
                    "shop": shop,
                    "cuisine": cuisine,
                    "phone": None,
                    "address": " ".join(part for part in road if part) or None,
                    "lat": round(lat, 7),
                    "lng": round(lng, 7),
                    "imported_at": imported_at,
                    "source": "sbiz",
                    "category": category,
                }


def main():
    zip_path, imported_at = sys.argv[1], sys.argv[2]
    pattern, menu_categories = menu_pattern()
    cells = osm_places_by_cell()
    counts = {"올림": 0, "OpenStreetMap 에 있음": 0, "좌표 없음": 0}
    places = read_places(zip_path, imported_at, pattern, menu_categories, cells, counts)
    if os.environ.get("DRY_RUN") == "1":
        for _ in places:
            pass
        print("시험: " + ", ".join(f"{label} {count:,}곳" for label, count in counts.items()), flush=True)
        return
    batch, total = [], 0
    for place in places:
        batch.append(place)
        if len(batch) == BATCH_SIZE:
            request("POST", "/rest/v1/places?on_conflict=osm_id", batch, {"Prefer": "resolution=merge-duplicates,return=minimal"})
            total += len(batch)
            batch = []
            if total % 20000 == 0:
                print(f"{total:,}곳 올림", flush=True)
    if batch:
        request("POST", "/rest/v1/places?on_conflict=osm_id", batch, {"Prefer": "resolution=merge-duplicates,return=minimal"})
    print("완료: " + ", ".join(f"{label} {count:,}곳" for label, count in counts.items()), flush=True)


if __name__ == "__main__":
    main()
