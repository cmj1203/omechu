"""대구광역시청 업무추진비 게시판 두 곳(시장·부시장, 실·국장·부서장·사업소)의 첨부 엑셀을 읽어 같은 모양의 기록으로 바꿔요. official_picks.py 가 불러 써요.

부서마다 엑셀 칸 이름·순서가 제각각이라 칸 이름(헤더 글자)으로 칸을 찾아요. 사용 장소에 주소는 없어요(가게 이름만).
시장 쪽은 .xls 와 .xlsx 가 섞여 있어서 .xls 는 xlrd 가 있을 때만 읽고, 없거나 못 여는 파일은 건너뛰어요.
"""
import concurrent.futures
import datetime
import re
import urllib.parse

from local_expenses import fetch, number, record, text, xlsx_rows

AGENCY = "대구광역시"
ORIGIN = "https://www.daegu.go.kr"
LIST_URL = ORIGIN + "/index.do"
FILE_URL = ORIGIN + "/icms/cmm/fms/FileDown.do?atchFileId={}&fileSn={}"
# (메뉴 번호, 게시판 번호): 시장·부시장 / 실·국장·부서장(본청 부서·사업소·소방서 등)
BOARDS = [("00941680", "BBS_00040"), ("00941690", "BBS_02348")]
MAX_PAGES = 600
WORKERS = 4
# 글 등록일은 기록 날짜보다 늦어서(분기가 끝난 뒤 올림), since 보다 이만큼 더 오래된 글이 나오면 멈춰요.
POST_SLACK = datetime.timedelta(days=120)

# 마지막 실행의 처리 결과(보고용).
STATS = {}


def clean(value):
    return re.sub(r"\s+", "", str(value))


def list_posts(menu, bbs, since):
    """목록(POST)을 최신 순으로 읽어 (글 제목, 담당부서, 첨부[(파일 번호, 순번)])를 모아요. 한 쪽의 절반 넘게 오래된 글이면 멈춰요."""
    posts = []
    limit = since - POST_SLACK
    for page in range(1, MAX_PAGES + 1):
        body = urllib.parse.urlencode({
            "menu_id": menu, "bbsId": bbs, "bbsTyCode": "BBST03", "bbsAttrbCode": "BBSA03", "nttId": "0", "pageIndex": page,
        }).encode()
        page_html = fetch(LIST_URL, body).decode("utf-8")
        rows = []
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page_html, re.S):
            title = re.search(r"fn_icms_navi_common\('view', '\d+'\)[^>]*>(.*?)</a>", row, re.S)
            posted = re.search(r"(20\d\d)-(\d\d)-(\d\d)", row)
            if title and posted:
                cells = [text(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
                files = re.findall(r"fn_egov_downFile\('([^']+)','(\d+)'\)", row)
                rows.append((text(title.group(1)), cells[2] if len(cells) > 2 else "", files, datetime.date(*map(int, posted.groups()))))
        if not rows:
            if page == 1:
                raise RuntimeError("대구광역시 업무추진비 게시판 목록을 읽지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")
            return posts
        older = 0
        for title, dept, files, posted in rows:
            older += posted < limit
            posts.append((title, dept, files))
        if older * 2 > len(rows):
            return posts
    raise RuntimeError("대구광역시 업무추진비 게시판 쪽 수 한도를 넘었어요.")


def download(file_id, serial):
    """한 번 실패하면 한 번 더 받아요."""
    for attempt in range(2):
        try:
            return fetch(FILE_URL.format(file_id, serial))
        except OSError:
            if attempt:
                raise


def xls_rows(data):
    """옛 엑셀(.xls)은 xlrd 가 있을 때만 읽어요(강남구 읽기와 같은 방식). 없거나 못 열면 None."""
    try:
        import xlrd
    except ImportError:
        return None
    try:
        book = xlrd.open_workbook(file_contents=data)
    except (xlrd.XLRDError, xlrd.compdoc.CompDocError):
        return None
    rows = []
    for sheet in book.sheets():
        for index in range(sheet.nrows):
            rows.append([str(int(v)) if isinstance(v, float) and v == int(v) else str(v).strip() for v in sheet.row_values(index)])
    return rows


def moment(day):
    """날짜 칸(엑셀 일련번호, 20260401, '2024.10.23.', '2026-07-01')을 날짜로 바꿔요. 시각은 없어요."""
    day = str(day).strip()
    if re.fullmatch(r"\d+(\.0+)?", day):
        value = int(float(day))
        if 30000 <= value < 80000:
            return datetime.datetime(1899, 12, 30) + datetime.timedelta(days=value)
        day = str(value)
    found = re.match(r"(20\d\d)\D*?(\d{1,2})\D*?(\d{1,2})", day) if not day.isdigit() else re.fullmatch(r"(20\d\d)(\d\d)(\d\d)", day)
    if not found:
        return None
    try:
        return datetime.datetime(*map(int, found.groups()))
    except ValueError:
        return None


def find_columns(cells):
    """헤더 줄이면 칸 번호를 돌려줘요. 장소 칸과 날짜 칸이 둘 다 있어야 헤더예요."""
    names = [clean(cell) for cell in cells]

    def first(pattern, exclude=None):
        for index, name in enumerate(names):
            if re.search(pattern, name) and not (exclude and re.search(exclude, name)):
                return index
        return None

    place = first("집행장소|사용장소|사용처|^장소")
    day = first("일자|일시|날짜|원인행위일|사용일")
    if place is None or day is None:
        return None
    return {
        "place": place,
        "day": day,
        "purpose": first("목적|내역"),
        "amount": first("금액"),
        "people": first("인원"),
        "user": first("사용자|부서"),
    }


def dept_label(post_dept, user):
    post_dept, user = " ".join(post_dept.split()), " ".join(user.split())
    return post_dept if not user or user in post_dept else (post_dept + " " + user).strip()


def not_a_store(place, purpose):
    return place in ("", "-", "--") or "경조" in place or "경조" in purpose


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

        when = moment(get("day"))
        # '엠프티커피 외 1곳' 은 앞 가게만 남겨야 이름으로 이어 붙일 수 있어요.
        place = re.sub(r"\s*외\s*\d+\s*(곳|건|개).*$", "", get("place")).strip()
        purpose = get("purpose")
        amount = number(get("amount").split(".")[0])
        if when is None or not (since <= when.date() <= today) or not amount or not_a_store(place, purpose):
            continue
        records.append(record(
            AGENCY, when, False, place, purpose, amount, number(get("people").split(".")[0]),
            dept_label(post_dept, get("user")), [AGENCY],
        ))
    return records


def read_attachment(file_id, serial, post_dept, since, today):
    """첨부 하나를 읽어 (기록, 상태)로 돌려줘요. 상태: ok / unsupported(PDF·한글·못 여는 엑셀) / unreadable(헤더 없음) / failed(받기 실패)."""
    try:
        data = download(file_id, serial)
    except OSError:
        return [], "failed"
    if data.startswith(b"PK"):
        try:
            rows = xlsx_rows(data)
        except Exception:  # 확장자만 xlsx 인 깨진 파일은 건너뛰어요.
            return [], "unsupported"
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
    posts = []
    for menu, bbs in BOARDS:
        posts.extend(list_posts(menu, bbs, since))
    attachments = {}
    for title, dept, files in posts:
        for file_id, serial in files:
            attachments.setdefault((file_id, serial), dept or title)
    if not attachments:
        raise RuntimeError("대구광역시 업무추진비 첨부 파일을 찾지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(lambda item: read_attachment(item[0][0], item[0][1], item[1], since, today), attachments.items()))

    statuses = [status for _, status in results]
    STATS.clear()
    STATS.update({"posts": len(posts), "attachments": len(attachments), **{name: statuses.count(name) for name in ("ok", "unsupported", "unreadable", "failed")}})
    if STATS["failed"] * 10 > len(attachments):
        raise RuntimeError(f"대구광역시 첨부 파일 {len(attachments)}개 중 {STATS['failed']}개를 받지 못했어요.")

    records, seen = [], set()
    for found, _ in results:
        for item in found:
            key = (item["when"], item["name"], item["amount"], item["dept"])
            if key not in seen:
                seen.add(key)
                records.append(item)
    records.sort(key=lambda item: item["when"])
    return records
