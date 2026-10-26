"""서울 중구청 업무추진비(부서별·구청장·부구청장 게시글에 붙은 엑셀)를 local_expenses.py 와 같은 모양의 기록으로 바꿔요.

중구 사전정보공표 게시판은 '글 1건 = 부서(또는 동) 1개월 + xlsx 1개' 구조예요. 목록을 읽고, 글마다 첨부 엑셀을 받아 읽어요.
엑셀에는 시각과 주소가 없어서 날짜만 쓰고(has_time=False), 가게는 official_picks.py 가 이름으로 이어 붙여요.
"""
import concurrent.futures
import datetime
import html
import re
import ssl
import urllib.error
import urllib.parse
import urllib.request

import local_expenses
from local_expenses import fetch, number, record, text, xlsx_rows

AGENCY = "중구"
ORIGIN = "https://www.junggu.seoul.kr"
BOARD = ORIGIN + "/popup/open.jsp?custom1={}&page2={}"
# 849 부서별, 845 구청장, 846 부구청장
BOARDS = (849, 845, 846)
MAX_PAGES = 400
WORKERS = 4

# 마지막 실행 결과(보고용). 받은 첨부 / 못 받아 건너뛴 첨부 / 엑셀이 아니라서 못 읽은 첨부
stats = {"posts": 0, "fetched": 0, "skipped": 0, "unsupported": 0}

# 칸 이름이 부서마다 조금씩 달라서, 이름에 들어 있는 말로 칸을 찾아요.
COLUMNS = {
    "date": ("사용일", "집행일", "일자"),
    "place": ("사용처", "가맹점", "장소"),
    "purpose": ("내용", "사용목적", "집행목적"),
    "people": ("대상인원", "인원"),
    "amount": ("사용금액", "금액"),
    "method": ("사용방법", "결제"),
    "kind": ("구분",),
}
NON_STORE = {"", "-", "--", "없음", "해당없음", "해당 없음"}


def get(url):
    """중구 홈페이지는 인증서 체인이 불완전해서 기본 검증이 실패해요. 그럴 때만 검증 없이 한 번 더 받아요(공개 자료만 받아요)."""
    try:
        return fetch(url)
    except urllib.error.URLError as error:
        if not isinstance(error.reason, ssl.SSLError):
            raise
    request = urllib.request.Request(url, headers={"User-Agent": local_expenses.USER_AGENT})
    context = ssl._create_unverified_context()
    with urllib.request.urlopen(request, timeout=120, context=context) as response:
        return response.read()


def get_retry(url):
    try:
        return get(url)
    except (urllib.error.URLError, OSError):
        return get(url)


def list_posts(board, page):
    """목록 한 쪽의 (글 주소, 제목, 공표부서, 공표일) 을 읽어요."""
    page_html = get_retry(BOARD.format(board, page)).decode("utf-8", "replace")
    posts = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page_html, re.S):
        link = re.search(r'<a href="(\?custom1=[^"]*cid=\d+[^"]*)"[^>]*>(.*?)</a>', row, re.S)
        cells = [text(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        posted = re.search(r"(20\d\d)-(\d\d)-(\d\d)", row)
        if link and posted and len(cells) >= 4:
            url = ORIGIN + "/popup/open.jsp" + html.unescape(link.group(1))
            posts.append((url, text(link.group(2)), cells[2], datetime.date(*map(int, posted.groups()))))
    return posts


def collect_posts(since):
    """공표일이 since 이후인 글을 모아요. 날짜가 어긋난 글이 섞여 있어서, 한 쪽의 절반 넘게 오래됐을 때 멈춰요."""
    collected = []
    for board in BOARDS:
        for page in range(1, MAX_PAGES + 1):
            posts = list_posts(board, page)
            if not posts:
                if page == 1:
                    raise RuntimeError(f"중구 업무추진비 목록({board})을 읽지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")
                break
            collected += [post for post in posts if post[3] >= since and "업무추진비" in post[1]]
            if sum(post[3] < since for post in posts) * 2 > len(posts):
                break
        else:
            raise RuntimeError("중구 업무추진비 목록 쪽 수 한도를 넘었어요.")
    return collected


def attachments(post_url):
    page_html = get_retry(post_url).decode("utf-8", "replace")
    paths = re.findall(r'href="(/cwsboard/board\.do\?mode=download[^"]+)"', page_html)
    return [ORIGIN + urllib.parse.quote(html.unescape(path), safe=":/?&=%+;,@") for path in dict.fromkeys(paths)]


def read_post(post):
    """글 하나의 첨부 엑셀을 받아 기록으로 바꿔요. 받기에 끝내 실패하면 None, 엑셀이 아니면 빈 목록을 돌려줘요."""
    url, title, dept, _ = post
    try:
        files = attachments(url)
        datas = [get_retry(file_url) for file_url in files]
    except (urllib.error.URLError, OSError):
        return None
    records = []
    for data in datas:
        if not data.startswith(b"PK"):
            stats["unsupported"] += 1
            continue
        records += rows_to_records(xlsx_rows(data), dept or title)
    return records


def find_columns(cells):
    """머리글 줄이면 {뜻: 칸 번호} 를, 아니면 None 을 돌려줘요. 사용일자와 사용처가 함께 있어야 머리글로 봐요."""
    found = {}
    for key, wants in COLUMNS.items():
        for position, cell in enumerate(cells):
            name = re.sub(r"\s+", "", cell)
            if name and any(want in name for want in wants) and position not in found.values():
                found[key] = position
                break
    return found if "date" in found and "place" in found and "amount" in found else None


def to_day(value):
    """엑셀 일련번호나 '2026.9.2.' 말고 '20260902' 같은 숫자도 있어서, excel_moment 가 넘치면 8자리 날짜로 읽어요."""
    try:
        return local_expenses.excel_moment(value, "")[0]
    except OverflowError:
        try:
            return datetime.datetime.strptime(value.split(".")[0], "%Y%m%d")
        except ValueError:
            return None


def rows_to_records(rows, dept):
    records = []
    col = None
    for cells in rows:
        header = find_columns(cells)
        if header:  # 시트마다 머리글이 다시 나올 수 있어요.
            col = header
            continue
        if not col:
            continue

        def cell(key):
            position = col.get(key)
            return cells[position].strip() if position is not None and position < len(cells) else ""

        moment = to_day(cell("date"))
        place = cell("place")
        amount = number(cell("amount").split(".")[0])
        if moment is None or place in NON_STORE or not amount:
            continue
        if "현금" in cell("method") and "경조" in cell("purpose") + cell("kind"):
            continue
        people = number(cell("people").split(".")[0])
        records.append(record(AGENCY, moment, False, place, cell("purpose"), amount, people, dept, [AGENCY]))
    return records


def fetch_records(since, today):
    """since ~ today 사이의 중구 업무추진비를 모두 읽어요."""
    posts = collect_posts(since)
    stats.update(posts=len(posts), fetched=0, skipped=0, unsupported=0)
    records = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for result in pool.map(read_post, posts):
            if result is None:
                stats["skipped"] += 1
            else:
                stats["fetched"] += 1
                records += result
    if posts and stats["skipped"] * 10 > len(posts):
        raise RuntimeError(f"중구 업무추진비 첨부 {len(posts)}개 중 {stats['skipped']}개를 받지 못했어요.")
    return [item for item in records if since <= item["when"].date() <= today]
