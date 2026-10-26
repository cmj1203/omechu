"""부산광역시청 '정보공개 > 업무추진비' 게시판(분기별 글, 첨부 엑셀)을 읽어 같은 모양의 기록으로 바꿔요. official_picks.py 가 불러 써요.

게시판은 두 개예요: 시장·부시장(schBizNo=46)과 실국본부장·4급 이상이 맡은 본청 부서·기관(schBizNo=45).
글마다 올린 부서가 달라서 엑셀 칸 순서가 제각각일 수 있어, 칸 이름(헤더 글자)으로 칸을 찾아요.
사용 장소에 주소는 없고 날짜만 있어요(시각 없음).
"""
import concurrent.futures
import datetime
import html
import re

from local_expenses import excel_moment, fetch, number, record, text, xlsx_rows

ORIGIN = "https://www.busan.go.kr"
LIST_URL = ORIGIN + "/ghopen12/list?schBizNo={}&curPage={}"
VIEW_URL = ORIGIN + "/ghopen12/view?schCommand=Expense&schIndx={}&schBizNo={}"
BOARDS = (46, 45)
MAX_PAGES = 1500
WORKERS = 4
AGENCY = "부산광역시"

# 마지막 실행의 처리 결과(보고용).
STATS = {}


def clean(value):
    return re.sub(r"\s+", "", str(value))


def list_posts(board, since):
    """목록을 최신 순으로 읽어 (글 번호, 제목, 담당부서)를 모아요. 한 쪽의 절반 넘게 since 보다 오래된 글이면 멈춰요.
    공표일은 분기가 끝난 뒤에 올라오니 기록 날짜보다 늦어서, since 이전에 올라온 글에는 since 이후 기록이 없어요."""
    posts = []
    for page in range(1, MAX_PAGES + 1):
        page_html = fetch(LIST_URL.format(board, page)).decode("utf-8")
        rows = []
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page_html, re.S):
            link = re.search(r"schIndx=(\d+)[^>]*>(.*?)</a>", row, re.S)
            posted = re.search(r"(20\d\d)-(\d\d)-(\d\d)", text(row))
            cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
            if link and posted and len(cells) >= 4:
                rows.append((link.group(1), text(link.group(2)), text(cells[2]), datetime.date(*map(int, posted.groups()))))
        if not rows:
            if page == 1:
                raise RuntimeError("부산광역시 업무추진비 게시판 목록을 읽지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")
            return posts
        older = 0
        for ntt, title, dept, posted in rows:
            older += posted < since
            if "업무추진비" in title:
                posts.append((ntt, board, title, dept))
        if older * 2 > len(rows):
            return posts
    raise RuntimeError("부산광역시 업무추진비 게시판 쪽 수 한도를 넘었어요.")


def download(url):
    """한 번 실패하면 한 번 더 받아요(fetch 가 서버 오류는 이미 다시 불러요)."""
    for attempt in range(2):
        try:
            return fetch(url)
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
            rows.append([
                str(int(value)) if isinstance(value, float) and value == int(value) else str(value).strip()
                for value in sheet.row_values(index)
            ])
    return rows


def find_columns(cells):
    """헤더 줄이면 칸 번호를 돌려줘요. 장소 칸과 일시 칸이 둘 다 있어야 헤더예요."""
    names = [clean(cell) for cell in cells]

    def first(pattern, exclude=None):
        for index, name in enumerate(names):
            if re.search(pattern, name) and not (exclude and re.search(exclude, name)):
                return index
        return None

    place = first("장소|사용처|가맹점")
    day = first("일시|일자|사용일")
    if place is None or day is None:
        return None
    return {
        "place": place,
        "day": day,
        "purpose": first("목적|내용|내역"),
        "amount": first("금액"),
        "people": first("인원"),
        "user": first("사용자|부서"),
    }


def moment(day):
    # 날짜 칸에 20260401 같은 여덟 자리 숫자가 적힌 파일이 있어요. excel_moment 는 이걸 엑셀 일련번호로 읽다 터져서 먼저 따로 읽어요.
    day = day.strip()
    if re.fullmatch(r"20\d{6}(\.0)?", day):
        try:
            return datetime.datetime.strptime(day[:8], "%Y%m%d"), False
        except ValueError:
            return None, False
    try:
        return excel_moment(day, "")
    except OverflowError:
        return None, False


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

        when, has_time = moment(get("day"))
        place = get("place")
        purpose = get("purpose")
        amount = number(get("amount").split(".")[0])
        if when is None or not (since <= when.date() <= today) or not amount or not_a_store(place, purpose):
            continue
        records.append(record(
            AGENCY, when, has_time, place, purpose, amount, number(get("people").split(".")[0]),
            (post_dept + " " + get("user")).strip(), [AGENCY],
        ))
    return records


def read_post(post, since, today):
    """글 하나의 첨부를 모두 읽어 (기록, 상태 목록)으로 돌려줘요. 상태: ok / unsupported(PDF·HWP) / unreadable(헤더 없음) / failed(받기 실패)."""
    ntt, board, _, dept = post
    records, statuses = [], []
    try:
        view = fetch(VIEW_URL.format(ntt, board)).decode("utf-8")
    except OSError:
        return records, ["failed"]
    for path in dict.fromkeys(re.findall(r'href="(/comm/getFile\?[^"]+)"', view)):
        try:
            data = download(ORIGIN + html.unescape(path))
        except OSError:
            statuses.append("failed")
            continue
        if data.startswith(b"PK"):
            try:
                rows = xlsx_rows(data)
            except Exception:  # 확장자만 엑셀이고 압축 파일이 깨진 첨부(zip 오류 등)는 읽을 수 없는 파일로 세어요.
                rows = None
        elif data.startswith(b"\xd0\xcf\x11\xe0"):
            rows = xls_rows(data)
        else:
            rows = None
        if rows is None:
            statuses.append("unsupported")
        elif not any(find_columns(cells) for cells in rows):
            statuses.append("unreadable")
        else:
            records.extend(parse_rows(rows, dept, since, today))
            statuses.append("ok")
    if not statuses:
        statuses.append("unsupported")  # 첨부가 아예 없는 글
    return records, statuses


def fetch_records(since, today):
    posts = []
    for board in BOARDS:
        posts.extend(list_posts(board, since))
    if not posts:
        raise RuntimeError("부산광역시 업무추진비 글을 찾지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(lambda post: read_post(post, since, today), posts))

    statuses = [status for _, group in results for status in group]
    STATS.clear()
    STATS.update({"posts": len(posts), "attachments": len(statuses), **{name: statuses.count(name) for name in ("ok", "unsupported", "unreadable", "failed")}})
    if STATS["failed"] * 10 > len(statuses):
        raise RuntimeError(f"부산광역시 첨부 파일 {len(statuses)}개 중 {STATS['failed']}개를 받지 못했어요.")

    records, seen = [], set()
    for found, _ in results:
        for item in found:
            key = (item["when"], item["name"], item["amount"], item["dept"])
            if key not in seen:
                seen.add(key)
                records.append(item)
    records.sort(key=lambda item: item["when"])
    return records
