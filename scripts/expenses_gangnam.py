"""강남구청 '업무추진비 집행내역' 게시판(부서·동별 월간 글, 첨부 엑셀)을 읽어 같은 모양의 기록으로 바꿔요. official_picks.py 가 불러 써요.

글마다 올린 부서가 달라서 엑셀 칸 이름·순서가 제각각이에요. 그래서 칸 이름(헤더 글자)으로 칸을 찾아요.
사용 장소에 주소는 없어요(가게 이름만).
"""
import concurrent.futures
import datetime
import re

import local_expenses
from local_expenses import fetch, number, record, text, xlsx_rows

ORIGIN = "https://www.gangnam.go.kr"
LIST_URL = ORIGIN + "/board/B_000673/list.do?mid=ID05_04200502&pgno={}"
MAX_PAGES = 400
WORKERS = 4
# 글 작성일이 기록 날짜보다 늦을 수 있어서(다음 달에 올림), since 보다 이만큼 더 오래된 글이 나오면 멈춰요.
POST_SLACK = datetime.timedelta(days=60)

# 마지막 실행의 첨부 처리 결과(보고용).
STATS = {}


def clean(value):
    return re.sub(r"\s+", "", str(value))


def list_posts(since):
    """목록을 최신 순으로 읽어 (글 제목, 담당부서, 첨부[(주소, 파일 이름)])를 모아요. 한 쪽의 절반 넘게 오래된 글이면 멈춰요."""
    posts = []
    limit = since - POST_SLACK
    for page in range(1, MAX_PAGES + 1):
        page_html = fetch(LIST_URL.format(page)).decode("utf-8")
        rows = []
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page_html, re.S):
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
            posted = re.search(r"(20\d\d)-(\d\d)-(\d\d)", text(cells[-1])) if len(cells) >= 4 else None
            if posted:
                rows.append((cells, datetime.date(*map(int, posted.groups()))))
        if not rows:
            if page == 1:
                raise RuntimeError("강남구 업무추진비 게시판 목록을 읽지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")
            return posts
        older = 0
        for cells, posted in rows:
            older += posted < limit
            files = re.findall(r'href="(/file/1/get/[^"]+/download\.do)"[^>]*>\s*<img[^>]*alt="([^"]*?) 다운로드"', cells[2], re.S)
            posts.append((text(cells[1]), text(cells[3]), files))
        if older * 2 > len(rows):
            return posts
    raise RuntimeError("강남구 업무추진비 게시판 쪽 수 한도를 넘었어요.")


def download(url):
    """한 번 실패하면 한 번 더 받아요."""
    for attempt in range(2):
        try:
            return fetch(ORIGIN + url)
        except OSError:
            if attempt:
                raise


def xls_rows(data):
    """옛 엑셀(.xls)은 xlrd 가 있을 때만 읽어요(서대문구 읽기와 같은 방식). 없으면 None."""
    try:
        import xlrd
    except ImportError:
        return None
    # 확장자만 .xls 이고 실제로는 엑셀이 아닌 첨부가 섞여 있어서, 못 여는 파일은 건너뛰어요.
    try:
        book = xlrd.open_workbook(file_contents=data)
    except (xlrd.XLRDError, xlrd.compdoc.CompDocError):
        return None
    rows = []
    for sheet in book.sheets():
        for index in range(sheet.nrows):
            cells = []
            for value in sheet.row_values(index):
                cells.append(str(int(value)) if isinstance(value, float) and value == int(value) else str(value).strip())
            rows.append(cells)
    return rows


def moment(day, clock):
    """날짜 칸(엑셀 일련번호나 '2026-09-01 12:33:34', '2026. 9. 1')과 시간 칸을 합쳐요. 시간이 있으면 두 번째 값이 True."""
    day, clock = day.strip(), clock.strip()
    try:
        number_day = float(day)
    except ValueError:
        found = re.match(r"(20\d\d)\D+?(\d{1,2})\D+?(\d{1,2})(?:\D+?(\d{1,2}):(\d{1,2}))?", day)
        if not found:
            return None, False
        year, month, date, hour, minute = found.groups()
        try:
            base = datetime.datetime(int(year), int(month), int(date))
        except ValueError:
            return None, False
        if hour is not None:
            return base.replace(hour=int(hour), minute=int(minute)), True
    else:
        if not 30000 <= number_day < 80000:
            return None, False
        base = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=number_day)
        if number_day % 1:
            return base.replace(microsecond=0), True
    try:
        return base + datetime.timedelta(days=float(clock) % 1), True
    except ValueError:
        found = re.match(r"(\d{1,2}):(\d{2})", clock)
        if found:
            return base.replace(hour=int(found.group(1)), minute=int(found.group(2))), True
    return base, False


def find_columns(cells):
    """헤더 줄이면 칸 번호를 돌려줘요. 장소(또는 가맹점) 칸과 날짜 칸이 둘 다 있어야 헤더예요."""
    names = [clean(cell) for cell in cells]

    def first(*patterns, exclude=()):
        for index, name in enumerate(names):
            if any(re.search(pattern, name) for pattern in patterns) and not any(re.search(pattern, name) for pattern in exclude):
                return index
        return None

    place = None
    for pattern in ("가맹점", "업소명|사업장|사용처", "장소"):
        place = first(pattern)
        if place is not None:
            break
    day = first("일자|일시|사용일|승인일|집행일|^일$")
    if place is None or day is None:
        return None
    return {
        "place": place,
        "day": day,
        "clock": first("시각|시간", exclude=("일시",)),
        "purpose": first("목적|내용|내역", exclude=("카드",)),
        "amount": first("금액|집행액"),
        "people": first("인원") if first("인원") is not None else first("집행대상"),
        "user": first("사용자|사용부서"),
    }


def not_a_store(place, purpose):
    return place in ("", "-", "--") or "경조" in place or "경조" in purpose or place.startswith("소속직원")


def parse_rows(rows, post_dept, since, today):
    records = []
    col = None
    for cells in rows:
        found = find_columns(cells)
        if found:
            col = found
            continue
        if col is None:
            continue

        def get(key):
            position = col[key]
            return cells[position].strip() if position is not None and position < len(cells) else ""

        when, has_time = moment(get("day"), get("clock"))
        place = get("place")
        purpose = get("purpose")
        amount = number(get("amount").split(".")[0])
        if when is None or not (since <= when.date() <= today) or not amount or not_a_store(place, purpose):
            continue
        records.append(record(
            "강남구", when, has_time, place, purpose, amount, number(get("people").split(".")[0]),
            (post_dept + " " + get("user")).strip(), ["강남구"],
        ))
    return records


def read_attachment(url, post_dept, since, today):
    """첨부 하나를 읽어 (기록, 상태)로 돌려줘요. 상태: ok / unsupported(옛 엑셀·PDF) / unreadable(헤더 없음) / failed(받기 실패)."""
    try:
        data = download(url)
    except OSError:
        return [], "failed"
    if data.startswith(b"PK"):
        rows = xlsx_rows(data)
    elif data.startswith(b"\xd0\xcf\x11\xe0"):
        rows = xls_rows(data)
        if rows is None:
            return [], "unsupported"
    else:
        return [], "unsupported"
    if not any(find_columns(cells) for cells in rows):
        return [], "unreadable"
    return parse_rows(rows, post_dept, since, today), "ok"


def fetch_records(since, today):
    posts = list_posts(since)
    attachments = {}
    for _, dept, files in posts:
        for url, _ in files:
            attachments.setdefault(url, dept)
    if not attachments:
        raise RuntimeError("강남구 업무추진비 첨부 파일을 찾지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(lambda item: read_attachment(item[0], item[1], since, today), attachments.items()))

    statuses = [status for _, status in results]
    STATS.clear()
    STATS.update({"posts": len(posts), "attachments": len(attachments), **{name: statuses.count(name) for name in ("ok", "unsupported", "unreadable", "failed")}})
    if STATS["failed"] * 10 > len(attachments):
        raise RuntimeError(f"강남구 첨부 파일 {len(attachments)}개 중 {STATS['failed']}개를 받지 못했어요.")

    records, seen = [], set()
    for found, _ in results:
        for item in found:
            key = (item["when"], item["name"], item["amount"], item["dept"])
            if key not in seen:
                seen.add(key)
                records.append(item)
    records.sort(key=lambda item: item["when"])
    return records
