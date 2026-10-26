"""용인시 업무추진비 게시판의 본청 첨부 엑셀을 읽어요."""
import concurrent.futures
import datetime
import html
import re
import urllib.parse
import zipfile

from local_expenses import excel_moment, fetch, number, record, text, xlsx_rows

# 조사 때 확인한 HTTP 주소를 써요. HTTPS는 일부 환경에서 TLS 연결이 실패해요.
ORIGIN = "http://www.yongin.go.kr"
BOARD = ORIGIN + "/user/bbs/"
LIST_URL = BOARD + "BD_selectBbsList.do?q_bbsCode=1001&q_clCode=6&q_rowPerPage=1000&q_currPage={}"
STATS = {}


def city_post(title, dept):
    """같은 게시판에 섞인 구청·읍면동 글은 제외해요."""
    if re.search(r"처인구|기흥구|수지구|구청|보건소", title + " " + dept):
        return False
    if re.search(r"(?:읍|면|동)$", dept.strip()):
        return False
    # 이 부서는 본청과 이름이 비슷해도 구청 소속이에요.
    return dept.strip() not in {
        "자치행정과", "민원지적과", "사회복지과", "가정복지과",
        "산업환경과", "생활민원과", "도로과", "건설과", "건설도로과",
        "교통과", "산업과", "환경위생과", "보건정책과", "보건행정과",
        "건강증진과", "도시미관과", "도시건축과",
        "도시건축1과", "도시건축2과", "세무1과", "세무2과",
    }


def list_posts(since):
    """천 줄씩 읽고 절반 넘게 오래된 쪽에서 멈춰 날짜 오기를 견뎌요."""
    posts = {}
    previous = None
    for page in range(1, 101):
        page_html = fetch(LIST_URL.format(page)).decode("utf-8")
        rows = []
        for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", page_html, re.S):
            cells = re.findall(r"<td\b[^>]*>(.*?)</td>", row, re.S)
            link = re.search(r'href="(BD_selectBbs\.do\?[^"]+)"[^>]*>(.*?)</a>', row, re.S)
            if not link or len(cells) < 6:
                continue
            date = re.search(r"(20\d\d)-(\d\d)-(\d\d)", text(cells[5]))
            if not date:
                continue
            rows.append((html.unescape(link[1]), text(link[2]), text(cells[4]),
                         datetime.date(*map(int, date.groups()))))
        if not rows or rows[0][0] == previous:
            raise RuntimeError("용인시 업무추진비 목록을 읽지 못했어요(빈 목록 또는 페이지 반복).")
        previous = rows[0][0]
        for path, title, dept, posted in rows:
            if posted >= since and city_post(title, dept):
                posts.setdefault(path, dept)
        if sum(posted < since for _, _, _, posted in rows) * 2 > len(rows):
            return list(posts.items())
        if len(rows) < 1000:
            return list(posts.items())
    raise RuntimeError("용인시 업무추진비 게시판 쪽 수 한도를 넘었어요.")


def find_columns(cells):
    """부서마다 다른 헤더 이름으로 열을 찾아요."""
    names = [re.sub(r"\s+", "", cell) for cell in cells]

    def first(pattern):
        return next((i for i, name in enumerate(names) if re.search(pattern, name)), None)

    day = first(r"일자|일시|사용일|집행일|^일$")
    place = first(r"가맹점|사용처|장소")
    amount = first(r"금액|집행액")
    if day is None or place is None or amount is None:
        return None
    clock = first(r"^시간$|^시각$")
    # '사용일시'가 날짜·시각 두 칸에 걸쳐 병합된 양식도 있어요.
    if clock is None and "일시" in names[day] and day + 1 < len(names) and not names[day + 1]:
        clock = day + 1
    return {"day": day, "clock": clock, "place": place, "amount": amount,
            "purpose": first(r"목적|내용|내역"), "people": first(r"인원"),
            "user": first(r"사용자|사용부서|집행부서")}


def moment(day, clock):
    """요일이 붙은 날짜와 따로 적힌 시각을 합쳐요."""
    embedded_time = False
    found = re.search(r"(20\d\d)\D+(\d{1,2})\D+(\d{1,2})", day)
    if found:
        year, month, date = map(int, found.groups())
        embedded = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", day[found.end():])
        if embedded:
            clock = embedded[0]
        try:
            day = datetime.date(year, month, date).isoformat()
        except ValueError:
            return None, False
    else:
        try:
            if not 30000 <= float(day) < 80000:
                return None, False
            embedded_time = bool(float(day) % 1)
        except ValueError:
            return None, False
    try:
        when, has_time = excel_moment(day, clock)
    except (ValueError, OverflowError):
        return None, False
    if when and has_time:
        when = when.replace(microsecond=0)
    return when, has_time or embedded_time


def parse_rows(rows, dept, since, today):
    """합계·현금 경조사 줄을 빼고 지정 기간의 기록만 만들어요."""
    records, columns = [], None
    for cells in rows:
        found = find_columns(cells)
        if found:
            columns = found
            continue
        if columns is None:
            continue

        def get(key):
            index = columns[key]
            return cells[index].strip() if index is not None and index < len(cells) else ""

        when, has_time = moment(get("day"), get("clock"))
        place, purpose = get("place"), get("purpose")
        amount = number(get("amount").split(".")[0])
        if when is None or not since <= when.date() <= today or not amount:
            continue
        if place in ("", "-", "--", "계", "합계") or re.search(r"경조|축의|부의", place + purpose):
            continue
        user = get("user")
        records.append(record("용인시", when, has_time, place, purpose, amount,
                              number(get("people").split(".")[0]),
                              " ".join(dict.fromkeys(part for part in (dept, user) if part)),
                              ["경기도 용인시"]))
    return records


def xls_rows(data):
    """구형 엑셀은 선택 설치된 xlrd로 모든 시트를 읽어요."""
    try:
        import xlrd
    except ImportError:
        return None
    try:
        book = xlrd.open_workbook(file_contents=data)
    except (xlrd.XLRDError, xlrd.compdoc.CompDocError):
        return None
    return [[str(int(v)) if isinstance(v, float) and v.is_integer() else str(v).strip()
             for v in sheet.row_values(i)]
            for sheet in book.sheets() for i in range(sheet.nrows)]


def read_post(item, since, today):
    """상세 화면의 첨부를 읽고 다운로드 실패와 미지원 형식을 따로 세어요."""
    path, dept = item
    page_html = fetch(BOARD + path).decode("utf-8")
    links = dict.fromkeys(html.unescape(path) for path in re.findall(
        r'(/component/file/ND_fileDownload\.do\?[^"\'<>\s]+)', page_html))
    counts = {"attachments": 0, "downloaded": 0, "failed": 0,
              "unsupported": 0, "unreadable": 0, "ok": 0, "empty_posts": 0}
    if not links:
        # 집행 내역 '없음'을 첨부 없이 본문으로 공표하는 부서도 있어요.
        if "첨부파일이 없습니다." in page_html and re.search(
                r"없음|내역.{0,20}없|사용.{0,20}없", text(page_html)):
            counts["empty_posts"] = 1
            return [], counts
        raise RuntimeError(f"용인시 업무추진비 상세 화면에서 첨부 링크를 찾지 못했어요: {path}")
    records = []
    for path in links:
        counts["attachments"] += 1
        try:
            data = fetch(urllib.parse.urljoin(ORIGIN, path))
        except OSError:
            counts["failed"] += 1
            continue
        counts["downloaded"] += 1
        if data.startswith(b"PK"):
            try:
                rows = xlsx_rows(data)
            except (zipfile.BadZipFile, KeyError):
                counts["unreadable"] += 1
                continue
        elif data.startswith(b"\xd0\xcf\x11\xe0"):
            rows = xls_rows(data)
            if rows is None:
                counts["unsupported"] += 1
                continue
        else:
            counts["unsupported"] += 1
            continue
        if not any(find_columns(cells) for cells in rows):
            counts["unreadable"] += 1
            continue
        counts["ok"] += 1
        records.extend(parse_rows(rows, dept, since, today))
    return records, counts


def fetch_records(since: datetime.date, today: datetime.date) -> list[dict]:
    """용인시 본청 게시글의 첨부를 최대 네 작업으로 읽어요."""
    STATS.clear()
    posts = list_posts(since)
    STATS.update({"posts": len(posts), "attachments": 0, "downloaded": 0,
                  "failed": 0, "unsupported": 0, "unreadable": 0, "ok": 0,
                  "empty_posts": 0})
    records = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for found, counts in pool.map(lambda item: read_post(item, since, today), posts):
            records.extend(found)
            for key, count in counts.items():
                STATS[key] += count
    if STATS["failed"] * 10 > STATS["attachments"]:
        raise RuntimeError(f"용인시 첨부 {STATS['attachments']}개 중 {STATS['failed']}개를 받지 못했어요.")
    unique = {}
    for item in records:
        key = (item["when"], item["name"], item["amount"], item["dept"])
        unique.setdefault(key, item)
    return sorted(unique.values(), key=lambda item: item["when"])
