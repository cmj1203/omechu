#!/usr/bin/env python3
# /// script
# requires-python = ">=3.10"
# dependencies = ["pyproj>=3.6", "pydantic>=2"]
# ///
"""인허가의 폐업·재영업 기록을 함께 대조해 검색 제외 목록을 다시 채워요.

실행: bash scripts/import-closed-places.sh
DRY_RUN=1 이면 DB를 바꾸지 않아요. CLOSED_PLACES_REPORT 경로에 판정 근거를 저장해요.
전국 키가 있어도 카페·제과점 누락을 막으려고 서울 세 업종을 함께 대조해요.
전국 명세: https://www.data.go.kr/data/15154916/openapi.do 의 내장 Swagger.
"""
import json
import http.client
import math
import os
import random
import re
import resource
import sys
import time
import urllib.parse
from collections import Counter, defaultdict
from collections.abc import Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import ClassVar, Final, TypeVar

from pydantic import BaseModel, ConfigDict, TypeAdapter, ValidationError

from pyproj import Transformer

SEOUL_SERVICES: Final = ("LOCALDATA_072404", "LOCALDATA_072405", "LOCALDATA_072218")
SEOUL_BOX: Final = (37.413, 37.716, 126.734, 127.270)
NATIONAL_BOX: Final = (33.0, 39.5, 124.0, 132.0)
NATIONAL_URL: Final = "https://apis.data.go.kr/1741000/general_restaurants/info"
# 하루 호출 한도가 10,000번이고 한 번에 100건만 줘서, 영업 중 전체(약 6,750번)와 최근 2년 폐업(약 1,550번)만 받아요.
NATIONAL_CLOSED_DAYS: Final = 730
# 깊은 페이지는 느리고 동시 16개면 504가 나서, 날짜 구간을 2만 건 이하로 나눠 8개씩 읽어요.
NATIONAL_CHUNK: Final = 20_000
NATIONAL_WORKERS: Final = 8
SBIZ_LAG: Final = timedelta(days=120)
TRANSFORM: Final = Transformer.from_crs("EPSG:5174", "EPSG:4326", always_xy=True)


T = TypeVar("T")


class Place(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)
    osm_id: str
    name: str
    address: str | None
    lat: float
    lng: float
    source: str
    imported_at: str | None = None

class LicenseInput(BaseModel):
    model_config: ClassVar[ConfigDict] = ConfigDict(frozen=True)
    BPLCNM: str
    TRDSTATENM: str
    DCBYMD: str | None = None
    RDNWHLADDR: str | None = None
    SITEWHLADDR: str | None = None
    X: str | float | None = None
    Y: str | float | None = None


class ApiResult(BaseModel):
    CODE: str
    MESSAGE: str


class SeoulData(BaseModel):
    list_total_count: int
    RESULT: ApiResult
    row: list[LicenseInput]


class NationalInput(BaseModel):
    BPLC_NM: str
    SALS_STTS_NM: str
    CLSBIZ_YMD: str | None = None
    ROAD_NM_ADDR: str | None = None
    LOTNO_ADDR: str | None = None
    CRD_INFO_X: str | float | None = None
    CRD_INFO_Y: str | float | None = None


class NationalItems(BaseModel):
    item: list[NationalInput] = []


class NationalBody(BaseModel):
    totalCount: int
    items: NationalItems


class NationalHeader(BaseModel):
    resultCode: str | int


class NationalResponse(BaseModel):
    header: NationalHeader
    body: NationalBody


class NationalPayload(BaseModel):
    response: NationalResponse


class ClosedPlace(BaseModel):
    osm_id: str
    name: str
    closed_on: str | None
    source: str
    checked_at: str


@dataclass(frozen=True, slots=True)
class License:
    name: str
    key: str
    address: str
    road: str
    lat: float | None
    lng: float | None
    closed: bool
    closed_on: str | None
    source: str


class Evidence(BaseModel):
    place: Place
    license: License
    distance: float | None


def normalized(value: str) -> str:
    value = re.sub(r"주식회사|\(주\)|주\)", "", value.lower())
    return "".join(char for char in value if char.isalnum())


def road_key(value: str, with_region: bool = True) -> str:
    # 층·호수 표기는 빼되 시·구는 보존해서 다른 지역의 같은 도로명을 혼동하지 않아요.
    found = re.search(r"([가-힣a-zA-Z0-9·.]+(?:로|길))\s+(\d+(?:-\d+)?)", value)
    if not found:
        return ""
    # 건물번호의 하이픈을 지우면 3-1번지와 31번지가 같은 주소가 돼요.
    street = value[:found.start(2)] if with_region else found.group(1)
    return normalized(street) + "#" + found.group(2)


def name_matches(first: str, second: str, strict: bool = False) -> bool:
    # 폐업 판정은 엄격하게: '이마트 은평점' 폐업 기록이 그 안의 '해물짬뽕 이마트 은평점'을 숨기지 않게
    # 짧은 이름이 긴 이름의 60% 이상일 때만 같은 가게로 봐요. 영업 기록(숨기지 않는 쪽)은 넉넉하게 봐요.
    if not (first and second):
        return False
    if first == second:
        return True
    shorter, longer = sorted((first, second), key=len)
    return len(shorter) >= 4 and shorter in longer and (not strict or len(shorter) / len(longer) >= 0.6)


def meters(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    # 판정 경계에서 평면 근사의 오차를 피하려고 구면 거리를 써요.
    dy, dx = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    a = math.sin(dy / 2) ** 2 + math.cos(math.radians(lat1)) * math.cos(math.radians(lat2)) * math.sin(dx / 2) ** 2
    return 12_742_000 * math.asin(min(1, math.sqrt(a)))


def request_bytes(method: str, url: str, body: bytes | None = None,
                  headers: dict[str, str] | None = None) -> bytes:
    # 예외의 URL에는 인증키가 들어갈 수 있어서 원래 예외 문자열을 출력하지 않아요.
    try:
        parts = urllib.parse.urlsplit(url)
        connection_type = http.client.HTTPSConnection if parts.scheme == "https" else http.client.HTTPConnection
        connection = connection_type(parts.netloc, timeout=120)
        try:
            connection.request(method, parts.path + ("?" + parts.query if parts.query else ""),
                               body=body, headers=headers or {})
            response = connection.getresponse()
            if not 200 <= response.status < 300:
                raise RuntimeError(f"자료 {method} 요청 실패: HTTP {response.status}")
            return response.read()
        finally:
            connection.close()
    except (OSError, http.client.HTTPException) as error:
        raise RuntimeError(f"자료 요청 실패: {type(error).__name__}") from None


def get_json(url: str, adapter: TypeAdapter[T]) -> T:
    try:
        return adapter.validate_json(request_bytes("GET", url))
    except ValidationError:
        raise RuntimeError("인허가 응답 형식이 공식 명세와 달라서 중단해요.") from None


def db_request(method: str, path: str, body: list[ClosedPlace] | None = None) -> bytes:
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    return request_bytes(method,
        os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path,
        body=None if body is None else json.dumps([row.model_dump() for row in body], ensure_ascii=False).encode(),
        headers={"apikey": key, "Authorization": "Bearer " + key,
                 "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal"},
    )


def parse_license(row: LicenseInput, source: str) -> License | None:
    name = row.BPLCNM.strip()
    status = row.TRDSTATENM.strip()
    if not name or status not in {"폐업", "영업/정상"}:
        return None
    x, y = str(row.X or "").strip(), str(row.Y or "").strip()
    lat = lng = None
    if x and y:
        lng, lat = TypeAdapter(tuple[float, float]).validate_json(
            json.dumps(TRANSFORM.transform(float(x), float(y))))
        # 0이나 잘못된 좌표를 주소 일치로 우회하면 엉뚱한 가게를 숨길 수 있어요.
        if not (33 <= lat <= 39.5 and 124 <= lng <= 132):
            return None
    raw_date = re.sub(r"\D", "", row.DCBYMD or "")
    closed_on = date(int(raw_date[:4]), int(raw_date[4:6]), int(raw_date[6:8])).isoformat() if len(raw_date) == 8 else None
    road = (row.RDNWHLADDR or "").strip()
    return License(name, normalized(name), road or (row.SITEWHLADDR or "").strip(),
                   road_key(road), lat, lng, status == "폐업", closed_on, source)


def seoul_page(service: str, start: int, end: int) -> tuple[int, list[LicenseInput]]:
    key = os.environ["SEOUL_OPENAPI_KEY"]
    payload = get_json(f"http://openapi.seoul.go.kr:8088/{key}/json/{service}/{start}/{end}/",
                       TypeAdapter(dict[str, SeoulData]))
    data = payload[service]
    if data.RESULT.CODE != "INFO-000" or data.list_total_count <= 0:
        raise RuntimeError(f"서울 {service} 응답이 정상이 아니어서 중단해요.")
    if len(data.row) != min(end, data.list_total_count) - start + 1:
        raise RuntimeError(f"서울 {service} 페이지 일부가 빠져서 동기화를 중단해요.")
    return data.list_total_count, data.row


def seoul_licenses() -> Iterator[License]:
    with ThreadPoolExecutor(max_workers=8) as pool:
        for service in SEOUL_SERVICES:
            total, first = seoul_page(service, 1, 1000)
            print(f"서울 {service}: {total:,}건", flush=True)
            for row in first:
                license_row = parse_license(row, "seoul")
                if license_row:
                    yield license_row
            # 한 번에 여덟 응답만 유지해서 전체 JSON을 메모리에 쌓지 않아요.
            for base in range(1001, total + 1, 8000):
                starts = range(base, min(base + 8000, total + 1), 1000)
                pages = [pool.submit(seoul_page, service, start, min(start + 999, total)) for start in starts]
                for page in pages:
                    actual_total, rows = page.result()
                    if actual_total != total:
                        raise RuntimeError("서울 자료 총건수가 실행 중 바뀌어서 동기화를 중단해요.")
                    for row in rows:
                        license_row = parse_license(row, "seoul")
                        if license_row:
                            yield license_row


def national_body(conditions: dict[str, str], page: int, rows: int = 100) -> NationalBody:
    query = urllib.parse.urlencode({
        "serviceKey": urllib.parse.unquote(os.environ["DATA_GO_KR_KEY"]),
        "pageNo": page, "numOfRows": rows, "returnType": "json", **conditions,
    })
    error = ""
    # 서버가 가끔 HTTP_ERROR나 504를 주므로, 전체 실행을 버리지 않게 같은 페이지만 다시 불러요.
    for wait in (10, 20, 40, 0):
        try:
            payload = get_json(NATIONAL_URL + "?" + query, TypeAdapter(NationalPayload)).response
            if str(payload.header.resultCode) in {"00", "0"}:
                return payload.body
            error = "전국 인허가 응답이 정상이 아니에요."
        except RuntimeError as failure:
            error = str(failure)
        time.sleep(wait)
    raise RuntimeError(f"전국 인허가 {page}쪽을 네 번 불러도 실패해서 중단해요: {error}")


def date_chunks(field: str, base: dict[str, str], start: date, end: date) -> Iterator[tuple[dict[str, str], int]]:
    # 서버는 날짜 칸을 글자 순서로 비교하고 대부분 '2024-05-01' 형식이라, 경계도 같은 형식으로 넣어야 구간이 고르게 나뉜요.
    conditions = {**base, f"cond[{field}::GTE]": start.isoformat(), f"cond[{field}::LT]": end.isoformat()}
    total = national_body(conditions, 1, 1).totalCount
    if total <= NATIONAL_CHUNK or (end - start).days <= 1:
        if total:
            yield conditions, total
        return
    middle = start + timedelta(days=(end - start).days // 2)
    yield from date_chunks(field, base, start, middle)
    yield from date_chunks(field, base, middle, end)


def national_licenses() -> Iterator[License]:
    """공식 Swagger의 100건 제한과 전국 필드명을 서울 공통 형식으로 맞춰요."""
    since = date.today() - timedelta(days=NATIONAL_CLOSED_DAYS)
    active = {"cond[SALS_STTS_CD::EQ]": "01"}
    # 끝을 먼 날로 잡아서 '20261019'처럼 형식이 다른 날짜도 어느 구간엔가 들어가게 해요.
    groups: tuple[tuple[str, str, dict[str, str], date, dict[str, str]], ...] = (
        ("영업", "LCPMT_YMD", active, date(1900, 1, 1), active),
        ("최근 폐업", "CLSBIZ_YMD", {}, since, {"cond[CLSBIZ_YMD::GTE]": since.isoformat()}),
    )
    chunks: list[tuple[dict[str, str], int]] = []
    for label, field, base, start, everything in groups:
        expected = national_body(everything, 1, 1).totalCount
        found = list(date_chunks(field, base, start, date(2100, 1, 1)))
        # 날짜가 비어 구간에서 빠지는 자료가 생기면 영업 기록을 놓쳐 엉뚱한 가게를 숨길 수 있어요.
        if expected <= 0 or sum(total for _, total in found) != expected:
            raise RuntimeError(f"전국 {label} 자료를 날짜 구간으로 나눈 합이 전체와 달라서 중단해요.")
        print(f"전국 일반음식점 {label}: {expected:,}건, {len(found)}구간", flush=True)
        chunks += found
    pages = [(conditions, total, page) for conditions, total in chunks for page in range(1, math.ceil(total / 100) + 1)]
    with ThreadPoolExecutor(max_workers=NATIONAL_WORKERS) as pool:
        # 한 번에 64쪽만 유지해서 전체 응답을 메모리에 쌓지 않아요.
        for base in range(0, len(pages), 64):
            window = pages[base:base + 64]
            bodies = [pool.submit(national_body, conditions, page) for conditions, _, page in window]
            for (_, total, page), body_future in zip(window, bodies):
                body = body_future.result()
                rows = body.items.item
                if body.totalCount != total:
                    raise RuntimeError("전국 자료 총건수가 실행 중 바뀌어서 동기화를 중단해요.")
                if len(rows) != min(100, total - (page - 1) * 100):
                    raise RuntimeError("전국 인허가 페이지 일부가 빠져서 동기화를 중단해요.")
                for row in rows:
                    license_row = parse_license(LicenseInput(
                        BPLCNM=row.BPLC_NM, TRDSTATENM=row.SALS_STTS_NM,
                        DCBYMD=row.CLSBIZ_YMD, RDNWHLADDR=row.ROAD_NM_ADDR,
                        SITEWHLADDR=row.LOTNO_ADDR, X=row.CRD_INFO_X, Y=row.CRD_INFO_Y,
                    ), "national")
                    if license_row:
                        yield license_row
            print(f"전국 인허가 {min(base + 64, len(pages)):,}/{len(pages):,}쪽", flush=True)


def places(box: tuple[float, float, float, float]) -> Iterator[Place]:
    last_id = ""
    south, north, west, east = box
    while True:
        # offset은 뒤쪽 페이지에서 시간 초과가 나므로 기존 가져오기처럼 키셋으로 읽어요.
        after = "&osm_id=gt." + urllib.parse.quote(last_id, safe="") if last_id else ""
        payload = db_request("GET", f"places?select=osm_id,name,address,lat,lng,source,imported_at&order=osm_id&limit=1000"
                             + f"&lat=gte.{south}&lat=lte.{north}&lng=gte.{west}&lng=lte.{east}{after}")
        rows = TypeAdapter(list[Place]).validate_json(payload)
        yield from rows
        if len(rows) < 1000:
            return
        last_id = rows[-1].osm_id


def run() -> None:
    started = time.monotonic()
    national = bool(os.environ.get("DATA_GO_KR_KEY"))
    if not national:
        print("DATA_GO_KR_KEY가 없어서 전국 자료는 건너뛰어요. 서울 세 업종만 판정해요.", flush=True)
    cells: dict[tuple[int, int], list[License]] = defaultdict(list)
    addresses: dict[str, list[License]] = defaultdict(list)
    license_counts: Counter[str] = Counter()
    streams = [seoul_licenses()]
    if national:
        streams.append(national_licenses())
    for stream in streams:
        for license_row in stream:
            license_counts[license_row.source] += 1
            if license_row.lat is not None and license_row.lng is not None:
                cells[(int(license_row.lat * 1000), int(license_row.lng * 1000))].append(license_row)
            # 영업 기록은 좌표가 없더라도 같은 주소면 보수적으로 폐업 판정을 막아요.
            if license_row.lat is None and license_row.road:
                addresses[license_row.road].append(license_row)
    print(f"인허가 색인 완료: {dict(license_counts)}", flush=True)
    rows: list[ClosedPlace] = []
    evidence: list[Evidence] = []
    coordinate_checks: list[Evidence] = []
    judged: Counter[str] = Counter()
    closed_counts: Counter[str] = Counter()
    checked_at = datetime.now(timezone.utc).isoformat()
    for place in places(NATIONAL_BOX if national else SEOUL_BOX):
        judged[place.source] += 1
        key, road = normalized(place.name), road_key(place.address or "")
        building = road_key(place.address or "", with_region=False)
        cy, cx = int(place.lat * 1000), int(place.lng * 1000)
        nearby = [record for y in range(cy - 1, cy + 2) for x in range(cx - 1, cx + 2)
                  for record in cells.get((y, x), ())]
        candidates = nearby + addresses.get(road, [])
        closed: list[tuple[License, float | None]] = []
        active = False
        # 상가정보는 석 달마다 '영업 중'인 가게만 담아서, 그보다 오래된 폐업 기록은 같은 자리의 새 가게예요.
        oldest_closure = (date.fromisoformat(place.imported_at[:10]) - SBIZ_LAG).isoformat() \
            if place.source == "sbiz" and place.imported_at else ""
        for record in candidates:
            if not name_matches(key, record.key, strict=record.closed):
                continue
            if record.closed and oldest_closure and (record.closed_on or "") < oldest_closure:
                continue
            distance = meters(place.lat, place.lng, record.lat, record.lng) if record.lat is not None and record.lng is not None else None
            same_address = bool(road and road == record.road)
            near = distance is not None and distance <= 50
            if not record.closed:
                if near or (record.lat is None and same_address):
                    active = True
                if near and key == record.key and same_address and len(coordinate_checks) < 100:
                    coordinate_checks.append(Evidence(place=place, license=record, distance=distance))
            elif near or (record.lat is None and same_address):
                # 같은 좌표에 잘못 붙은 주소가 표본에서 나와서, 건물번호가 다르면 숨기지 않아요.
                licensed_building = road_key(record.address, with_region=False)
                if building and licensed_building and building != licensed_building:
                    continue
                closed.append((record, distance))
        if active or not closed:
            continue
        record, distance = max(closed, key=lambda item: item[0].closed_on or "")
        rows.append(ClosedPlace(osm_id=place.osm_id, name=place.name, closed_on=record.closed_on,
                                source=record.source, checked_at=checked_at))
        closed_counts[place.source] += 1
        evidence.append(Evidence(place=place, license=record, distance=distance))
    samples = random.SystemRandom().sample(evidence, min(25, len(evidence)))
    print(f"판정 가게: {dict(judged)}, 폐업 가게: {dict(closed_counts)}", flush=True)
    for index, sample in enumerate(samples, 1):
        print(f"표본 {index}: " + sample.model_dump_json(), flush=True)
    if os.environ.get("DRY_RUN") != "1":
        # 먼저 새 목록을 올리고 성공한 뒤 옛 행만 지워서 중간 실패 시 기존 목록을 보존해요.
        for offset in range(0, len(rows), 1000):
            _ = db_request("POST", "closed_places?on_conflict=osm_id", rows[offset:offset + 1000])
        for source in ("seoul", "national") if national else ("seoul",):
            _ = db_request("DELETE", f"closed_places?source=eq.{source}&checked_at=lt.{urllib.parse.quote(checked_at, safe='')}")
    elapsed = round(time.monotonic() - started, 2)
    peak_memory = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss / (1048576 if sys.platform == "darwin" else 1024)
    report = os.environ.get("CLOSED_PLACES_REPORT")
    if report:
        _ = Path(report).write_text(json.dumps({
            "judged": dict(judged), "closed": dict(closed_counts), "seconds": elapsed,
            "license_counts": dict(license_counts),
            "peak_memory_mib": round(peak_memory, 2),
            "dry_run": os.environ.get("DRY_RUN") == "1", "matches": [item.model_dump() for item in evidence],
            "samples": [item.model_dump() for item in samples],
            "coordinate_checks": [item.model_dump() for item in coordinate_checks],
        }, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"{'시험 판정' if os.environ.get('DRY_RUN') == '1' else '동기화'} 완료: "
          + f"{len(rows):,}곳, {elapsed}초, 최대 메모리 {peak_memory:.1f}MiB", flush=True)


if __name__ == "__main__":
    try:
        run()
    except (RuntimeError, KeyError, ValueError) as error:
        print(f"폐업 자료 처리를 중단했어요: {error}", file=sys.stderr)
        sys.exit(1)
