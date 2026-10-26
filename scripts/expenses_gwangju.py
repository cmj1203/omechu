"""광주(전남광주통합특별시, 옛 광주광역시) 시청 '업무추진비 집행내역' 게시판(부서별 분기 글, 첨부 옛 엑셀 .xls)을 읽어 같은 모양의 기록으로 바꿔요. official_picks.py 가 불러 써요.

첨부가 옛 엑셀(.xls)이라 xlrd 가 있어야 읽혀요(없으면 RuntimeError). 칸 이름·순서가 글마다 달라서 헤더 글자로 칸을 찾고,
사용 장소에 주소는 없어요(가게 이름만).
"""
import concurrent.futures
import datetime
import html
import re

import local_expenses
from local_expenses import fetch, number, record, text

ORIGIN = "https://www.gwangju.go.kr"
LIST_URL = ORIGIN + "/boardList.do?boardId=BD_0000000252&pageId=www101&movePage={}&recordCnt=100"
AGENCY = "광주"
GUS = ["전남광주통합특별시 동구", "전남광주통합특별시 서구", "전남광주통합특별시 남구", "전남광주통합특별시 북구", "전남광주통합특별시 광산구"]
MAX_PAGES = 200
WORKERS = 4
# 글 작성일이 기록 날짜보다 늦을 수 있어서(분기가 끝난 뒤에 올림), since 보다 이만큼 더 오래된 글이 나오면 멈춰요.
POST_SLACK = datetime.timedelta(days=120)

# 마지막 실행의 첨부 처리 결과(보고용).
STATS = {}


def clean(value):
    return re.sub(r"\s+", "", str(value))


def list_posts(since):
    """목록을 최신 순으로 읽어 (제목, 작성 부서, 첨부 주소 목록)을 모아요. 한 쪽의 절반 넘게 오래된 글이면 멈춰요."""
    posts = []
    limit = since - POST_SLACK
    for page in range(1, MAX_PAGES + 1):
        page_html = fetch(LIST_URL.format(page)).decode("utf-8")
        rows = []
        for block in page_html.split('class="body_row"')[1:]:
            posted = re.search(r'class="date">.*?(20\d\d)-(\d\d)-(\d\d)', block, re.S)
            title = re.search(r'data-seq="\d+" title="([^"]*)"', block)
            if not (posted and title):
                continue
            writer = re.search(r'class="writer">(.*?)</div>', block, re.S)
            files = [html.unescape(path) for path in re.findall(r'href="(/fileDownload\.do\?[^"]+)"', block)]
            rows.append((html.unescape(title.group(1)), text(re.sub(r"<!--.*?-->|<span class=\"blind\">.*?</span>", "", writer.group(1), flags=re.S)) if writer else "",
                         files, datetime.date(*map(int, posted.groups()))))
        if not rows:
            if page == 1:
                raise RuntimeError("광주 업무추진비 게시판 목록을 읽지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")
            return posts
        older = 0
        for title, writer, files, posted in rows:
            older += posted < limit
            posts.append((title, writer, files))
        if older * 2 > len(rows):
            return posts
    raise RuntimeError("광주 업무추진비 게시판 쪽 수 한도를 넘었어요.")


def download(url):
    """한 번 실패하면 한 번 더 받아요."""
    for attempt in range(2):
        try:
            return fetch(ORIGIN + url)
        except OSError:
            if attempt:
                raise


def xls_rows(data, xlrd):
    """옛 엑셀(.xls)의 모든 시트(시책추진·기관운영)를 줄 목록으로 바꿔요. 확장자만 .xls 인 가짜 파일은 None."""
    try:
        book = xlrd.open_workbook(file_contents=data)
    except (xlrd.XLRDError, xlrd.compdoc.CompDocError):
        return None
    rows = []
    for sheet in book.sheets():
        for index in range(sheet.nrows):
            rows.append([str(int(value)) if isinstance(value, float) and value == int(value) else str(value).strip()
                         for value in sheet.row_values(index)])
    return rows


def moment(cell):
    """'2026-04-01\\n12:07', '2026-04-9' 같은 칸에서 날짜와 시각을 읽어요. 시각이 있으면 두 번째 값이 True."""
    found = re.search(r"(20\d\d)\D+?(\d{1,2})\D+?(\d{1,2})(?!\d)(?:\D+?(\d{1,2}):(\d{2}))?", cell)
    if not found:
        return None, False
    year, month, day, hour, minute = found.groups()
    try:
        base = datetime.datetime(int(year), int(month), int(day))
    except ValueError:
        return None, False
    if hour is not None:
        try:
            return base.replace(hour=int(hour), minute=int(minute)), True
        except ValueError:
            pass
    return base, False


def find_columns(cells):
    """헤더 줄이면 칸 번호를 돌려줘요. 장소 칸과 일시 칸이 둘 다 있어야 헤더예요(한 시트에 헤더가 여러 번 나와도 돼요)."""
    names = [clean(cell) for cell in cells]

    def first(*patterns):
        for index, name in enumerate(names):
            if any(re.search(pattern, name) for pattern in patterns):
                return index
        return None

    place = first("사용장소|사용처|가맹점|^장소")
    day = first("사용일시|사용일자|일시|일자")
    if place is None or day is None:
        return None
    return {
        "place": place, "day": day, "purpose": first("집행목적|목적|내용"),
        "amount": first("금액"), "people": first("인원"), "user": first("사용자"),
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

        when, has_time = moment(get("day"))
        place = get("place")
        purpose = get("purpose")
        amount = number(get("amount").split(".")[0])
        if when is None or not (since <= when.date() <= today) or not amount or not_a_store(place, purpose):
            continue
        # 한 칸에 가게 둘이 줄바꿈으로 들어 있으면 공백 하나로 이어 둬요.
        records.append(record(
            AGENCY, when, has_time, " ".join(place.split()), purpose, amount, number(get("people").split(".")[0]),
            (post_dept + " " + get("user")).strip(), GUS,
        ))
    return records


def read_attachment(url, post_dept, since, today, xlrd):
    """첨부 하나를 읽어 (기록, 상태)로 돌려줘요. 상태: ok / unsupported(PDF·HWP 등) / unreadable(헤더 없음·가짜 xls) / failed(받기 실패)."""
    try:
        data = download(url)
    except OSError:
        return [], "failed"
    if data.startswith(b"PK"):
        try:
            rows = local_expenses.xlsx_rows(data)
        except local_expenses.XLSX_ERRORS:
            return [], "unreadable"
    elif data.startswith(b"\xd0\xcf\x11\xe0"):
        rows = xls_rows(data, xlrd)
        if rows is None:
            return [], "unreadable"
    else:
        return [], "unsupported"
    if not any(find_columns(cells) for cells in rows):
        return [], "unreadable"
    return parse_rows(rows, post_dept, since, today), "ok"


def fetch_records(since, today):
    try:
        import xlrd
    except ImportError:
        raise RuntimeError("광주 업무추진비 첨부가 옛 엑셀(.xls)이라 xlrd 가 필요해요. `uv run --with xlrd` 로 실행해 주세요.")
    posts = list_posts(since)
    attachments = {}
    for title, writer, files in posts:
        for url in files:
            attachments.setdefault(url, " ".join(part for part in (title, writer) if part))
    if not attachments:
        raise RuntimeError("광주 업무추진비 첨부 파일을 찾지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(lambda item: read_attachment(item[0], item[1], since, today, xlrd), attachments.items()))

    statuses = [status for _, status in results]
    STATS.clear()
    STATS.update({"posts": len(posts), "attachments": len(attachments), **{name: statuses.count(name) for name in ("ok", "unsupported", "unreadable", "failed")}})
    if STATS["failed"] * 10 > len(attachments):
        raise RuntimeError(f"광주 첨부 파일 {len(attachments)}개 중 {STATS['failed']}개를 받지 못했어요.")

    records, seen = [], set()
    for found, _ in results:
        for item in found:
            key = (item["when"], item["name"], item["amount"], item["dept"])
            if key not in seen:
                seen.add(key)
                records.append(item)
    records.sort(key=lambda item: item["when"])
    return records
