"""도봉구청 '업무추진비 집행내역' 게시판(부서·동별 월 1건)의 첨부 엑셀을 읽어 같은 모양의 기록으로 바꿔요.

official_picks.py 가 불러 써요. 첨부는 xls/xlsx 가 대부분이고 일부는 PDF 라서, PDF 는 건너뛰고 개수만 세어요.
"""
import concurrent.futures
import datetime
import html
import re
import urllib.parse

from local_expenses import XLSX_ERRORS, excel_moment, fetch, number, record, text, xlsx_rows

AGENCY = "도봉구"
ORIGIN = "https://www.dobong.go.kr"
LIST_URL = ORIGIN + "/bbs.asp?code=10008860&intPage={}"
VIEW_URL = ORIGIN + "/bbs.asp?bmode=D&pcode={}&code=10008860"
MAX_PAGES = 400
WORKERS = 4
# 부서마다 칸 이름이 달라서(일 자/일시/사용일시, 장 소/사용장소 ...) 공백을 지운 이름에 이 낱말이 들어 있는지로 찾아요.
COLUMN_WORDS = {
    "date": ("일자", "일시", "사용일", "집행일"),
    "time": ("시간",),
    "place": ("장소", "구매처"),
    "purpose": ("목적", "내역", "내용"),
    "people": ("인원",),
    "amount": ("금액",),
    "user": ("사용자",),
}


def list_posts(since):
    """목록을 최신 순으로 넘기며 (글번호, 제목, 등록일, 부서)를 모아요. 한 쪽이 통째로 since 보다 오래되면 멈춰요.
    등록이 늦은 글이 섞일 수 있어서 한 줄이 아니라 한 쪽 전체로 판단해요."""
    posts = []
    for page in range(1, MAX_PAGES + 1):
        found = []
        for row in re.findall(r"<tr[^>]*>(.*?)</tr>", fetch(LIST_URL.format(page)).decode("utf-8", "replace"), re.S):
            link = re.search(r"pcode=(\d+)[^>]*>(.*?)</a>", row, re.S)
            posted = re.search(r"(20\d\d)\.(\d\d)\.(\d\d)", row)
            if not (link and posted):
                continue
            dept = re.search(r'data-cell-header="담당부서">(.*?)</td>', row, re.S)
            found.append((link.group(1), text(link.group(2)), datetime.date(*map(int, posted.groups())), text(dept.group(1)) if dept else ""))
        if not found:
            if page == 1:
                raise RuntimeError("도봉구 업무추진비 게시판 목록을 읽지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")
            return posts
        posts.extend(post for post in found if post[2] >= since)
        if all(post[2] < since for post in found):
            return posts
    raise RuntimeError("도봉구 업무추진비 게시판 쪽 수 한도를 넘었어요.")


def attachments(pcode):
    """글 한 건의 첨부 [(제목, 주소)]. 목록의 아이콘은 xlsx 도 'xls' 로 찍혀 있어서 첨부 제목의 확장자를 봐요."""
    page = fetch(VIEW_URL.format(pcode)).decode("utf-8", "replace")
    found = []
    for href, title in re.findall(r"""<a[^>]*href="(/WDB_common/include/download\.asp[^"]+)"[^>]*title=['"]([^'"]*)['"]""", page):
        found.append((html.unescape(title), ORIGIN + html.unescape(href)))
    return found


def download(url):
    """한 번 실패하면 다시 한 번 받아요. 그래도 안 되면 None."""
    for _ in range(2):
        try:
            return fetch(url)
        except OSError:
            continue
    return None


def xls_rows(data):
    """옛 엑셀(.xls)은 xlrd 가 있을 때만 읽어요. 없으면 None(건너뛴 첨부로 세요)."""
    try:
        import xlrd
    except ImportError:
        return None

    # 확장자만 .xls 이고 실제로는 엑셀이 아닌 첨부가 섞여 있어서, 못 여는 파일은 건너뛰어요.
    try:
        book = xlrd.open_workbook(file_contents=data)
    except (xlrd.XLRDError, xlrd.compdoc.CompDocError):
        return []
    rows = []
    for sheet in book.sheets():
        for index in range(sheet.nrows):
            rows.append([str(value).strip() for value in sheet.row_values(index)])
    return rows


def moment(day, time):
    """날짜 칸이 엑셀 일련번호(46269)·'2026-09-01'·'2026. 9. 11.(금) 11:28' 중 무엇이든 읽고, 시각은 날짜 칸 안이나 시간 칸에서 찾아요."""
    if re.fullmatch(r"20\d{6}", day.strip()):
        # 일부 부서는 날짜를 20260901 처럼 숫자 여덟 자리로 적어요.
        day = f"{day.strip()[:4]}-{day.strip()[4:6]}-{day.strip()[6:]}"
    try:
        serial = float(day)
    except ValueError:
        serial = None
    if serial is not None:
        # 합계 줄 등의 작은 숫자가 날짜로 읽혀 범위 오류가 나지 않게 2000~2100년 사이 일련번호만 받아요.
        if not 36526 <= serial <= 73415:
            return None, False
        if serial % 1 and not time:
            return datetime.datetime(1899, 12, 30) + datetime.timedelta(days=serial), True
        return excel_moment(day, time)
    found = re.search(r"(20\d\d)\D+(\d{1,2})\D+(\d{1,2})", day)
    if not found:
        return None, False
    try:
        base = datetime.datetime(*map(int, found.groups()))
    except ValueError:
        return None, False
    clock = re.search(r"(\d{1,2}):(\d{2})", day[found.end():]) or re.search(r"(\d{1,2}):(\d{2})", time or "")
    if clock and int(clock.group(1)) < 24 and int(clock.group(2)) < 60:
        return base.replace(hour=int(clock.group(1)), minute=int(clock.group(2))), True
    return excel_moment(base.strftime("%Y-%m-%d"), time)


def find_columns(cells):
    # 표 머리 칸 이름은 짧아서, 긴 목적 글이 우연히 '금액' 등을 담은 줄은 머리로 보지 않아요.
    squeezed = [re.sub(r"\s", "", cell) if len(cell) <= 20 else "" for cell in cells]
    col = {}
    for key, words in COLUMN_WORDS.items():
        for position, name in enumerate(squeezed):
            if name and any(word in name for word in words) and position not in col.values():
                col[key] = position
                break
    # 날짜·장소·금액 칸이 모두 있어야 표 머리로 봐요.
    return col if {"date", "place", "amount"} <= col.keys() else None


def parse_rows(rows, dept, since, today):
    records = []
    col = None
    for cells in rows:
        header = find_columns(cells)
        if header:
            col = header
            continue
        if col is None:
            continue

        def pick(key):
            position = col.get(key)
            return cells[position] if position is not None and position < len(cells) else ""

        place = pick("place")
        when, has_time = moment(pick("date"), pick("time"))
        # 경조사비 현금·'-' 장소처럼 가게가 아닌 줄과 합계 줄은 건너뛰어요.
        if when is None or not place or place in ("-", "－", "—") or "경조사" in place or place == "현금":
            continue
        amount = number(pick("amount").split(".")[0])
        if not amount or not (since <= when.date() <= today):
            continue
        records.append(record(AGENCY, when, has_time, place, pick("purpose"), amount,
                              number(pick("people").split(".")[0]), pick("user") or dept, [AGENCY]))
    return records


def fetch_records(since, today):
    posts = list_posts(since)
    if not posts:
        raise RuntimeError("도봉구 업무추진비 글을 하나도 찾지 못했어요.")
    with concurrent.futures.ThreadPoolExecutor(WORKERS) as pool:
        listed = list(pool.map(lambda post: attachments(post[0]), posts))
        jobs = []
        skipped_other = 0
        for post, files in zip(posts, listed):
            sheets = [(title, url) for title, url in files if re.search(r"\.xlsx?\b", title, re.I)]
            skipped_other += len(files) - len(sheets)
            jobs.extend((post[3], url) for _, url in sheets)
        downloaded = list(pool.map(lambda job: download(job[1]), jobs))

    failed = sum(data is None for data in downloaded)
    if jobs and failed * 10 > len(jobs):
        raise RuntimeError(f"도봉구 첨부 {len(jobs)}개 중 {failed}개를 받지 못했어요.")
    if not jobs:
        raise RuntimeError("도봉구 업무추진비 엑셀 첨부를 하나도 찾지 못했어요. PDF 로만 올라오는지 확인해 주세요.")
    records = []
    for (dept, _), data in zip(jobs, downloaded):
        if data is None:
            continue
        if data.startswith(b"PK"):
            try:
                rows = xlsx_rows(data)
            except XLSX_ERRORS:
                skipped_other += 1
                continue
        elif data.startswith(b"\xd0\xcf\x11\xe0"):
            rows = xls_rows(data)
            if rows is None:
                skipped_other += 1
                continue
        else:
            skipped_other += 1
            continue
        records.extend(parse_rows(rows, dept, since, today))
    fetch_records.stats = {"posts": len(posts), "excel": len(jobs) - failed, "failed": failed, "skipped_non_excel": skipped_other}
    return records
