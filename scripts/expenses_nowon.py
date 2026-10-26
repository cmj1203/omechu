import concurrent.futures
import datetime
import html
import io
import re
import zipfile

import local_expenses

NOWON_LIST = "https://nowon.kr/www/user/bbs/BD_selectBbsList.do?q_bbsCode=1012&q_currPage={}"
NOWON_ORIGIN = "https://nowon.kr"
MAX_PAGES = 400
WORKERS = 4
# 장소 칸이 가게가 아닌 줄(현금 경조사비, 칸 비움 표시 등)
NOT_A_STORE = re.compile(r"^[-–—.\s]*$|경조사|조화|조의|축의|부조")
# 이번 실행에서 건너뛴 첨부 (PDF, 받기 실패, 칸 이름 다름)
skipped = {"pdf": [], "hwp": [], "failed": [], "header": []}
fetched = 0


def place_name(value):
    # 'A외 1' 처럼 여러 곳이 묶여 있으면 첫 곳만 써요
    return re.sub(r"\s*외\s*\d+\s*$", "", value.strip()).strip()


def list_posts(page_html):
    posts = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page_html, re.S):
        link = re.search(r'class="cell-file">\s*<a href="([^"]+)"', row, re.S)
        date = re.search(r'class="cell-date">\s*(\d{4})-(\d\d)-(\d\d)', row)
        dept = re.search(r'class="cell-part">(.*?)</td>', row, re.S)
        if link and date:
            posts.append((
                html.unescape(link.group(1)),
                datetime.date(*map(int, date.groups())),
                local_expenses.text(dept.group(1)) if dept else "",
            ))
    return posts


def download(href):
    # 한 번 실패하면 한 번만 더 받아 봐요
    for attempt in range(2):
        try:
            return local_expenses.fetch(NOWON_ORIGIN + href)
        except OSError:
            if attempt:
                return None


def parse_workbook(data, dept, since, today):
    rows = local_expenses.xlsx_rows(data)
    header = None
    for index, cells in enumerate(rows):
        names = [cell.replace(" ", "") for cell in cells]
        if any("사용장소" in name for name in names) and any("결재일" in name or "사용일" in name for name in names):
            header = index
            col = {name: position for position, name in enumerate(names)}
            break
    if header is None:
        return None

    def pick(cells, *wanted):
        for name, position in col.items():
            if any(want in name for want in wanted):
                return cells[position] if position < len(cells) else ""
        return ""

    records = []
    for cells in rows[header + 1:]:
        day = pick(cells, "결재일", "사용일").strip()
        # 일부 부서는 엑셀 날짜 대신 20260902 같은 여덟 자리 숫자로 적어요
        if re.fullmatch(r"20\d{6}(\.0)?", day):
            day = f"{day[:4]}-{day[4:6]}-{day[6:8]}"
        try:
            moment, _ = local_expenses.excel_moment(day, "")
        except OverflowError:
            continue
        place = place_name(pick(cells, "사용장소"))
        if moment is None or not since <= moment.date() <= today or NOT_A_STORE.search(place):
            continue
        amount = local_expenses.number(pick(cells, "사용금액", "금액").split(".")[0])
        records.append(local_expenses.record(
            "노원구", moment, False, place, pick(cells, "사용내역", "사용목적"), amount,
            local_expenses.number(pick(cells, "인원").split(".")[0]),
            pick(cells, "사용자") or dept, ["노원구"],
        ))
    return records


def fetch_records(since, today):
    global fetched
    fetched = 0
    for names in skipped.values():
        names.clear()
    attachments = []
    # 목록은 최신 글부터라, 한 쪽이 통째로 since 보다 오래되면 멈춰요 (날짜가 한두 개 어긋난 글은 건너뛰고 계속 읽어요)
    for page in range(1, MAX_PAGES + 1):
        posts = list_posts(local_expenses.fetch(NOWON_LIST.format(page)).decode("utf-8"))
        if not posts:
            if page == 1:
                raise RuntimeError("노원구 업무추진비 게시판 목록을 읽지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")
            break
        attachments += [(href, dept) for href, posted, dept in posts if posted >= since]
        if all(posted < since for _, posted, _ in posts):
            break
    else:
        raise RuntimeError("노원구 업무추진비 게시판 쪽 수 한도를 넘었어요.")

    def load(item):
        href, dept = item
        data = download(href)
        if data is None:
            return item, "failed", None
        # hwpx 도 zip(PK)이라, 엑셀인지는 zip 안의 xl/workbook.xml 로 가려요
        if data.startswith(b"PK") and "xl/workbook.xml" not in zipfile.ZipFile(io.BytesIO(data)).namelist():
            return item, "hwp", None
        if not data.startswith(b"PK"):
            return item, "hwp" if data.startswith(b"\xd0\xcf\x11\xe0") else "pdf", None
        parsed = parse_workbook(data, dept, since, today)
        return item, ("header" if parsed is None else "ok"), parsed

    records = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        for item, status, parsed in pool.map(load, attachments):
            if status == "ok":
                fetched += 1
                records += parsed
            else:
                skipped[status].append(item)
    broken = len(skipped["failed"]) + len(skipped["header"])
    if attachments and broken * 10 > len(attachments):
        raise RuntimeError(f"노원구 첨부 {len(attachments)}건 중 {broken}건을 읽지 못했어요(받기 실패 또는 칸 이름 다름).")
    return records
