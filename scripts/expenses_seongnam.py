"""성남시청 '업무추진비' 게시판(본청 부서별 월간 글, 첨부 엑셀)을 읽어 같은 모양의 기록으로 바꿔요. official_picks.py 가 불러 써요.

본청 부서·구청장·구 과·동장 글이 한 게시판에 같이 올라와요. 글마다 올린 부서가 달라서 엑셀 칸 이름이 제각각일 수 있어,
칸 이름(헤더 글자)으로 칸을 찾아요. 사용 장소에 주소는 없어요(가게 이름만).
"""
import concurrent.futures
import datetime
import io
import json
import re
import ssl
import time
import urllib.error
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

import local_expenses
from local_expenses import excel_moment, number, record, text, xlsx_rows

AGENCY = "성남시"
GUS = ["경기도 성남시"]
ORIGIN = "https://www.seongnam.go.kr"
# 목록이 cntPerPage 를 그대로 받아서 한 번에 전체(2001년부터 2,765건)를 받아요.
LIST_URL = ORIGIN + "/bbs030408?cntPerPage=3000"
FILES_URL = ORIGIN + "/bbs030408/atchFileDetail?pstSn={}"
DOWNLOAD_URL = ORIGIN + "/bbs030408/getFile?bbsCrtSn={}&pstSn={}&fileNo={}"
BOARD_SN = 17008
WORKERS = 4
# 글은 기록 달이 지난 뒤에 올라와서, since 보다 이만큼 더 오래된 글은 건너뛰어요.
POST_SLACK = datetime.timedelta(days=60)

# 마지막 실행의 첨부 처리 결과(보고용).
STATS = {}

_CONTEXT = ssl.create_default_context()
try:
    # 성남시 서버는 AES128-SHA 암호만 받는데, 최신 OpenSSL 은 기본 보안 수준에서 그걸 빼서 연결이 끊겨요.
    _CONTEXT.set_ciphers("DEFAULT:@SECLEVEL=1")
except ssl.SSLError:
    pass
_OPENER = urllib.request.build_opener(urllib.request.HTTPSHandler(context=_CONTEXT))


def fetch(url):
    """local_expenses.fetch 와 같은 헤더·재시도 규칙인데, 위 암호 설정을 쓰려고 따로 열어요."""
    request = urllib.request.Request(url, headers={"User-Agent": local_expenses.USER_AGENT})
    for attempt in range(3):
        try:
            with _OPENER.open(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code < 500 or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == 2:
                raise
        time.sleep(5)


def list_posts(since):
    """목록 전체에서 (글 번호, 제목, 담당부서) 중 업무추진비 글이고 첨부가 있고 since 근처 이후인 것만 모아요."""
    page_html = fetch(LIST_URL).decode("utf-8")
    limit = since - POST_SLACK
    posts, seen_rows = [], 0
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page_html, re.S):
        sn = re.search(r"fn_move_form\('(\d+)'\)", row)
        cells = re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)
        posted = re.search(r"(20\d\d)-(\d\d)-(\d\d)", text(cells[3])) if len(cells) >= 6 else None
        if not (sn and posted):
            continue
        seen_rows += 1
        if datetime.date(*map(int, posted.groups())) < limit:
            continue
        title = text(re.search(r"fn_move_form.*?>(.*?)</a>", row, re.S).group(1))
        if "업무추진비" in title and "첨부파일있음" in cells[5]:
            # 담당부서 칸 앞의 '담당부서' 라벨 글자는 떼요.
            posts.append((sn.group(1), title, text(cells[2]).removeprefix("담당부서").strip()))
    if not seen_rows:
        raise RuntimeError("성남시 업무추진비 게시판 목록을 읽지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")
    return posts


def clean(value):
    return re.sub(r"\s+", "", str(value))


def xls_rows(data):
    """옛 엑셀(.xls)은 xlrd 가 있을 때만 읽어요. 없거나 못 여는 파일이면 None."""
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


def hwpx_rows(data):
    """한글 문서(.hwpx)는 zip 안의 section XML 표예요. 칸 안의 문단은 줄바꿈으로 이어 엑셀 읽기와 같은 줄 목록으로 만들어요."""
    archive = zipfile.ZipFile(io.BytesIO(data))
    rows = []
    for name in sorted(n for n in archive.namelist() if re.match(r"Contents/section\d+\.xml$", n)):
        for row in ET.fromstring(archive.read(name)).iter():
            if not row.tag.endswith("}tr"):
                continue
            cells = []
            for cell in row:
                if cell.tag.endswith("}tc"):
                    paragraphs = ["".join(p.itertext()).strip() for p in cell.iter() if p.tag.endswith("}p")]
                    cells.append("\n".join(line for line in paragraphs if line))
            rows.append(cells)
    return rows


def find_columns(cells):
    """헤더 줄이면 칸 번호를 돌려줘요. 장소(사용처) 칸과 날짜 칸이 둘 다 있어야 헤더예요."""
    names = [clean(cell) for cell in cells]

    def first(pattern, exclude=None):
        for index, name in enumerate(names):
            if re.search(pattern, name) and not (exclude and re.search(exclude, name)):
                return index
        return None

    place = first("장소|사용처|가맹점|업소")
    day = first("일시|일자|사용일|집행일")
    if place is None or day is None:
        return None
    clock = first("시각|시간")
    # '일시' 칸이 위아래로 합쳐진 표는 시각이 헤더 이름 없는 바로 옆 칸에 있어요.
    if clock is None and day + 1 < len(names) and not names[day + 1]:
        clock = day + 1
    return {
        "place": place, "day": day, "clock": clock,
        "purpose": first("목적|내역|내용"), "amount": first("금액"),
        "people": first("인원"), "user": first("사용자|부서"),
    }


def not_a_store(place, purpose):
    # 한 칸에 가게가 여러 곳(줄바꿈, '외 N')이면 금액을 가게별로 나눌 수 없어 건너뛰어요.
    return (
        place in ("", "-", "--") or "\n" in place or re.search(r"외\s*\d+\s*(곳|개소)?$", place)
        or "경조" in place or "경조" in purpose or re.search("축의금|조의금|부의금", purpose) or "결제대행" in place or "인터넷" in place
    )


def parse_rows(rows, post_dept, since, today, skipped):
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

        # 합계 줄처럼 날짜 칸에 큰 숫자가 든 줄은 날짜로 바꿀 수 없어 건너뛰어요.
        day, clock = get("day"), get("clock")
        # 한글 표는 날짜 칸 안에 날짜와 시각이 두 줄로 같이 들어 있어요.
        found_clock = re.search(r"(\d{1,2}):(\d{2})", day)
        if found_clock and not clock:
            clock, day = found_clock.group(0), day[:found_clock.start()].strip()
        try:
            when, has_time = excel_moment(day, clock)
        except (OverflowError, ValueError):
            continue
        place = get("place")
        purpose = get("purpose")
        amount = number(get("amount").split(".")[0])
        if when is None or not (since <= when.date() <= today) or not amount:
            continue
        if not_a_store(place, purpose):
            skipped["not_store"] += 1
            continue
        records.append(record(
            AGENCY, when, has_time, place, purpose, amount, number(get("people").split(".")[0]),
            " ".join((post_dept + " " + get("user")).split()), GUS,
        ))
    return records


def read_post(post, since, today):
    """글 하나의 첨부를 모두 읽어 (기록, 상태 목록)으로 돌려줘요. 상태: ok / unsupported / unreadable / failed."""
    sn, _, dept = post
    skipped = {"not_store": 0}
    try:
        files = json.loads(fetch(FILES_URL.format(sn)).decode("utf-8"))["atchFileVO"]
    except (OSError, ValueError, KeyError):
        return [], ["failed"], skipped
    records, statuses = [], []
    for item in files:
        try:
            data = fetch(DOWNLOAD_URL.format(BOARD_SN, sn, item["fileNo"]))
        except OSError:
            statuses.append("failed")
            continue
        if data.startswith(b"PK"):
            try:
                is_hwpx = "Contents/section0.xml" in zipfile.ZipFile(io.BytesIO(data)).namelist()
            except zipfile.BadZipFile:
                rows = None
            else:
                # 배포용으로 암호화된 한글 문서는 XML 로 읽히지 않아서 지원 안 함으로 세요.
                try:
                    rows = hwpx_rows(data) if is_hwpx else xlsx_rows(data)
                except ET.ParseError:
                    rows = None
        elif data.startswith(b"\xd0\xcf\x11\xe0"):
            rows = xls_rows(data)
        else:
            rows = None  # PDF·HWP 등
        if rows is None:
            statuses.append("unsupported")
        elif not any(find_columns(cells) for cells in rows):
            statuses.append("unreadable")
        else:
            statuses.append("ok")
            records.extend(parse_rows(rows, dept, since, today, skipped))
    return records, statuses, skipped


def fetch_records(since, today):
    posts = list_posts(since)
    if not posts:
        raise RuntimeError("성남시 업무추진비 글을 찾지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")

    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        results = list(pool.map(lambda post: read_post(post, since, today), posts))

    statuses = [status for _, found, _ in results for status in found]
    STATS.clear()
    STATS.update({"posts": len(posts), "attachments": len(statuses),
                  **{name: statuses.count(name) for name in ("ok", "unsupported", "unreadable", "failed")},
                  "not_store_rows": sum(skipped["not_store"] for _, _, skipped in results)})
    if STATS["failed"] * 10 > len(posts):
        raise RuntimeError(f"성남시 첨부 {len(posts)}개 글 중 {STATS['failed']}건을 받지 못했어요.")

    records, seen = [], set()
    for found, _, _ in results:
        for item in found:
            key = (item["when"], item["name"], item["amount"], item["dept"])
            if key not in seen:
                seen.add(key)
                records.append(item)
    records.sort(key=lambda item: item["when"])
    return records
