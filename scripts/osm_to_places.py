#!/usr/bin/env python3
"""osmium 으로 뽑은 식당 데이터(geojsonseq)를 Supabase places 표에 넣어요. import-places.sh 가 실행해요.

사용법: python3 scripts/osm_to_places.py <food.geojsonseq> <가져오기 시작 시각(ISO)>
환경 변수: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (.env.local), DRY_RUN=1 이면 올리지 않고 가게 수만 세요
"""
import json
import os
import sys
import urllib.error
import urllib.request

BATCH_SIZE = 2000


def centroid(geometry):
    kind, coords = geometry["type"], geometry["coordinates"]
    if kind == "Point":
        return coords[0], coords[1]
    if kind == "LineString":
        ring = coords
    elif kind == "Polygon":
        ring = coords[0]
    elif kind == "MultiPolygon":
        ring = coords[0][0]
    else:
        raise ValueError("모르는 도형: " + kind)
    return sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring)


def address(props):
    if props.get("addr:full"):
        return props["addr:full"]
    parts = [props.get(k) for k in ("addr:province", "addr:city", "addr:district", "addr:street", "addr:housenumber")]
    return " ".join(p for p in parts if p) or None


def read_places(path, imported_at):
    seen = set()
    with open(path, encoding="utf-8") as lines:
        for line in lines:
            line = line.lstrip("\x1e").strip()
            if not line:
                continue
            feature = json.loads(line)
            props = feature["properties"]
            name = (props.get("name") or props.get("name:ko") or "").strip()
            osm_id = props["@type"][0] + str(props["@id"])
            if not name or osm_id in seen:
                continue
            seen.add(osm_id)
            lng, lat = centroid(feature["geometry"])
            yield {
                "osm_id": osm_id,
                "name": name[:120],
                "amenity": props.get("amenity"),
                "shop": props.get("shop"),
                "cuisine": props.get("cuisine"),
                "phone": props.get("phone") or props.get("contact:phone"),
                "address": address(props),
                "lat": round(lat, 7),
                "lng": round(lng, 7),
                "imported_at": imported_at,
            }


def upload(rows):
    url = os.environ["SUPABASE_URL"] + "/rest/v1/places?on_conflict=osm_id"
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    request = urllib.request.Request(
        url,
        data=json.dumps(rows, ensure_ascii=False).encode("utf-8"),
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
    path, imported_at = sys.argv[1], sys.argv[2]
    if os.environ.get("DRY_RUN") == "1":
        total = sum(1 for _ in read_places(path, imported_at))
        print(f"시험: 올릴 가게 {total:,}곳", flush=True)
        return
    batch, total = [], 0
    for place in read_places(path, imported_at):
        batch.append(place)
        if len(batch) == BATCH_SIZE:
            upload(batch)
            total += len(batch)
            batch = []
            print(f"{total:,}곳 올림", flush=True)
    if batch:
        upload(batch)
    total += len(batch)
    print(f"완료: {total:,}곳", flush=True)


if __name__ == "__main__":
    main()
