"""대전광역시청 '업무추진비 집행내역' 게시판(부서·월별 글, 첨부 엑셀)을 읽어 같은 모양의 기록으로 바꿔요. official_picks.py 가 불러 써요.

게시판은 3급 이상 실·국장(747)과 4급 이상 과장급(694) 둘이에요. 엑셀은 '시책추진'·'부서운영' 두 시트로 나뉘어 있어서
칸 이름(헤더 글자)으로 칸을 찾아요. 사용 장소 끝에 '(서구 둔산동 1440)' 같은 주소가 붙어 있어 이름에서는 떼어 내요.
"""
import concurrent.futures
import datetime
import http.client
import re
import threading
import time
import urllib.parse

from local_expenses import USER_AGENT, XLSX_ERRORS, fetch, number, record, text, xlsx_rows

ORIGIN = "https://www.daejeon.go.kr"
BOARD = ORIGIN + "/drh/open/drhDataOpen/"
LIST_URL = BOARD + "drhDataOpenBoardView.do?boardSeq={}&menuSeq=4804&subPageIndex={}"
ARTICLE_URL = BOARD + "drhDataOpenBoardArticleView.do?menuSeq=4804&boardSeq={}&articleSeq={}"
BOARDS = (747, 694)
MAX_PAGES = 400
WORKERS = 6
# 글·첨부가 3,000개 넘게 있고, 서버가 새 연결이 몰리면 일부를 받지 않아 연결에만 20초씩 걸려요.
# 그래서 일꾼마다 연결 하나를 열어 두고 다시 쓰고, 답이 없으면 짧게 끊고 새 연결로 다시 불러요.
GET_TIMEOUT = 20
_local = threading.local()
# 글은 다음 달에 올라오고 작성일이 순서와 어긋나기도 해서, 글의 해당 월이 since 보다 이만큼 더 오래돼야 '오래된 글'로 봐요.
POST_SLACK = datetime.timedelta(days=60)
# 가게가 아니라 결제 대행·온라인 구매가 이름 자리에 들어간 줄은 걸러요.
NOT_STORE = ("결제대행", "인터넷", "쿠팡", "경조")

# 마지막 실행의 첨부 처리 결과(보고용).
STATS = {}


def post_month_end(title, posted):
    """제목의 'YYYY년 M월'(없으면 작성일)이 속한 달의 마지막 날."""
    found = re.search(r"(20\d\d)년\s*(\d{1,2})월", title)
    year, month = (int(found.group(1)), int(found.group(2))) if found else (posted.year, posted.month)
    if not 1 <= month <= 12:
        year, month = posted.year, posted.month
    return (datetime.date(year + month // 12, month % 12 + 1, 1)) - datetime.timedelta(days=1)


def list_posts(board, since):
    """목록을 최신 순으로 읽어 (글 번호, 제목, 담당부서)를 모아요. 한 쪽의 절반 넘게 오래된 글이면 멈춰요."""
    posts = []
    limit = since - POST_SLACK
    for page in range(1, MAX_PAGES + 1):
        page_html = fetch(LIST_URL.format(board, page)).decode("utf-8")
        rows = []
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page_html, re.S):
            link = re.search(r"articleSeq=(\d+)[^>]*>(.*?)</a>", row, re.S)
            posted = re.search(r"(20\d\d)-(\d\d)-(\d\d)", row)
            if link and posted:
                cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
                title = text(link.group(2))
                rows.append((link.group(1), title, text(cells[3]) if len(cells) > 3 else "", datetime.date(*map(int, posted.groups()))))
        if not rows:
            if page == 1:
                raise RuntimeError("대전시 업무추진비 게시판 목록을 읽지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")
            return posts
        older = 0
        for seq, title, dept, posted in rows:
            older += post_month_end(title, posted) < limit
            posts.append((seq, title, dept))
        if older * 2 > len(rows):
            return posts
    raise RuntimeError("대전시 업무추진비 게시판 쪽 수 한도를 넘었어요.")


def get(url):
    """일꾼의 연결로 받아요. 20초 안에 답이 없거나 연결이 끊기거나 서버 오류면, 새 연결로 2초 뒤 두 번 더 불러요."""
    parts = urllib.parse.urlsplit(url)
    path = parts.path + ("?" + parts.query if parts.query else "")
    for attempt in range(3):
        connection = getattr(_local, "connection", None)
        if connection is None:
            connection = _local.connection = http.client.HTTPSConnection(parts.netloc, timeout=GET_TIMEOUT)
        try:
            connection.request("GET", path, headers={"User-Agent": USER_AGENT})
            response = connection.getresponse()
            body = response.read()
        except (OSError, http.client.HTTPException) as error:
            connection.close()
            _local.connection = None
            if attempt == 2:
                raise OSError(f"대전시 서버에서 받지 못했어요: {url}") from error
        else:
            if response.status == 200:
                return body
            if response.status < 500 or attempt == 2:
                raise OSError(f"대전시 서버가 {response.status} 을 줬어요: {url}")
        time.sleep(2)


def xls_rows(data):
    """옛 엑셀(.xls)은 xlrd 가 있을 때만 읽어요(강남구 읽기와 같은 방식). 없으면 None."""
    try:
        import xlrd
    except ImportError:
        return None
    # 확장자만 .xls 이거나 파일이 깨진 첨부(글자 해독 실패)는 건너뛰어요.
    try:
        book = xlrd.open_workbook(file_contents=data)
    except (xlrd.XLRDError, xlrd.compdoc.CompDocError, UnicodeDecodeError):
        return None
    rows = []
    for sheet in book.sheets():
        for index in range(sheet.nrows):
            rows.append([str(int(v)) if isinstance(v, float) and v == int(v) else str(v).strip() for v in sheet.row_values(index)])
    return rows


def find_columns(cells):
    """헤더 줄이면 칸 번호를 돌려줘요. 장소(가맹점)와 날짜 칸이 둘 다 있어야 헤더예요."""
    names = [re.sub(r"\s+", "", cell) for cell in cells]

    def first(pattern):
        for index, name in enumerate(names):
            if re.search(pattern, name):
                return index
        return None

    place = first("가맹점|사용장소|사용처|장소")
    day = first("일자|일시|사용일")
    if place is None or day is None:
        return None
    return {
        "place": place, "day": day, "purpose": first("목적|내역|내용"), "amount": first("금액"),
        "people": first("인원"), "user": first("사용자"),
    }


def moment(value):
    """'2026-09-02(12:10)' 처럼 날짜에 시각이 붙은 칸을 읽어요. 시각이 없으면 두 번째 값이 False."""
    found = re.match(r"\s*(20\d\d)\D+?(\d{1,2})\D+?(\d{1,2})(?:\D+?(\d{1,2}):(\d{2}))?", value)
    if not found:
        return None, False
    year, month, day, hour, minute = found.groups()
    try:
        base = datetime.datetime(int(year), int(month), int(day))
        if hour is not None:
            return base.replace(hour=int(hour), minute=int(minute)), True
    except ValueError:
        return None, False
    return base, False


def clean_name(place):
    """끝의 '(서구 둔산동 1440)' 같은 주소 괄호만 떼고, 줄바꿈은 공백으로 바꿔요."""
    return re.sub(r"\s*\([^()]*\)\s*$", "", " ".join(place.split())).strip()


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

        def pick(key):
            position = col[key]
            return cells[position].strip() if position is not None and position < len(cells) else ""

        when, has_time = moment(pick("day"))
        place = pick("place")
        name = clean_name(place)
        amount = number(pick("amount").split(".")[0])
        if when is None or not (since <= when.date() <= today) or not amount:
            continue
        if name in ("", "-", "--") or any(word in place for word in NOT_STORE):
            continue
        records.append(record(
            "대전광역시", when, has_time, name, pick("purpose"), amount, number(pick("people").split(".")[0]),
            (post_dept + " " + pick("user")).strip(), ["대전광역시"],
        ))
    return records


def read_post(board, seq, dept, since, today):
    """글 하나의 첨부를 모두 읽어 (기록, 상태 목록)을 돌려줘요. 상태: ok / unsupported(PDF·HWP) / unreadable(헤더 없음) / failed(받기 실패)."""
    try:
        article = get(ARTICLE_URL.format(board, seq)).decode("utf-8")
    except OSError:
        return [], ["failed"]
    paths = list(dict.fromkeys(re.findall(r"fileDownLoad\('([^']+)'", article)))
    records, statuses = [], []
    for path in paths:
        try:
            data = get(ORIGIN + "/" + path.lstrip("/"))
        except OSError:
            statuses.append("failed")
            continue
        if data.startswith(b"PK"):
            # 확장자만 엑셀이고 압축이 깨진 첨부는 읽을 수 없는 파일로 세고 넘어가요.
            try:
                rows = xlsx_rows(data)
            except XLSX_ERRORS:
                statuses.append("unreadable")
                continue
        elif data.startswith(b"\xd0\xcf\x11\xe0"):
            rows = xls_rows(data)
        else:
            rows = None
        if rows is None:
            statuses.append("unsupported")
        elif not any(find_columns(cells) for cells in rows):
            statuses.append("unreadable")
        else:
            statuses.append("ok")
            records.extend(parse_rows(rows, dept, since, today))
    return records, statuses


def fetch_records(since, today):
    posts = {}
    for board in BOARDS:
        for seq, _, dept in list_posts(board, since):
            posts.setdefault((board, seq), dept)
    if not posts:
        raise RuntimeError("대전시 업무추진비 글을 찾지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(lambda item: read_post(item[0][0], item[0][1], item[1], since, today), posts.items()))

    statuses = [status for _, found in results for status in found]
    STATS.clear()
    STATS.update({"posts": len(posts), "attachments": len(statuses), **{name: statuses.count(name) for name in ("ok", "unsupported", "unreadable", "failed")}})
    if not statuses:
        raise RuntimeError("대전시 업무추진비 첨부 파일을 찾지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")
    if STATS["failed"] * 10 > len(statuses):
        raise RuntimeError(f"대전시 첨부 파일 {len(statuses)}개 중 {STATS['failed']}개를 받지 못했어요.")

    records, seen = [], set()
    for found, _ in results:
        for item in found:
            key = (item["when"], item["name"], item["amount"], item["dept"])
            if key not in seen:
                seen.add(key)
                records.append(item)
    records.sort(key=lambda item: item["when"])
    return records
