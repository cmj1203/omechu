"""양천구 부서·동별 업무추진비 첨부 엑셀을 읽어요."""

import concurrent.futures
import collections
import datetime
import html
import http.client
import re
import sys
import urllib.error
import urllib.parse
import xml.etree.ElementTree as ET
import zipfile

import local_expenses as local

try:
    import xlrd
except ImportError:
    xlrd = None


ORIGIN = "https://www.yangcheon.go.kr"
BOARD = ORIGIN + "/site/yangcheon/ex/bbs/"
DOWNLOAD_ERRORS = (OSError, urllib.error.URLError, http.client.HTTPException)


def download(url: str, referer: str | None = None) -> bytes:
    """일시적인 다운로드 실패만 한 번 더 시도해요."""
    for attempt in range(2):
        try:
            return local.fetch(url, referer=referer)
        except DOWNLOAD_ERRORS:
            if attempt:
                raise
    raise RuntimeError("양천구 파일을 받지 못했어요.")


def moment(day: str, clock: str) -> tuple[datetime.datetime | None, bool]:
    """사용일시 한 칸인 파일과 사용일·시간이 나뉜 파일을 함께 읽어요."""
    day = day.strip()
    if re.fullmatch(r"20\d{6}", day):
        day = f"{day[:4]}-{day[4:6]}-{day[6:]}"
    found = re.search(
        r"(20\d{2})\s*[년./-]+\s*(\d{1,2})\s*[월./-]+\s*(\d{1,2})", day
    )
    if found:
        combined = re.search(r"(\d{1,2}):(\d{2})(?::(\d{2}))?", day)
        if combined and not clock:
            clock = combined.group()
        day = "-".join(f"{int(part):02d}" for part in found.groups())
    try:
        result, has_time = local.excel_moment(day, clock)
    except (ValueError, OverflowError):
        return None, False
    if result is None:
        return None, False
    # 일련번호 소수부에도 시간이 담겨 있어 별도 시간 칸 없이 보존해요.
    if not clock:
        has_time = result.time() != datetime.time()
    result = (result + datetime.timedelta(microseconds=500000)).replace(microsecond=0)
    return result, has_time


def expense_rows(
    rows: list[list[str]], since: datetime.date, today: datetime.date, dept: str
) -> list[dict]:
    """부서마다 달라지는 열 이름과 여러 시트의 반복 머리글을 읽어요."""
    records = []
    columns = {}
    headers = 0
    year = None
    aliases = {
        "day": ("사용일", "집행일", "결제일", "결재일", "일시", "일자"),
        "time": ("시간", "시각"),
        "place": ("장소", "가맹점", "상호"),
        "purpose": ("집행목적", "사용목적", "사용내역", "집행내역", "사용내용"),
        "amount": ("금액", "집행액"),
        "people": ("인원",),
        "user": ("사용자", "집행자", "사용부서"),
    }
    for cells in rows:
        heading = " ".join(cells)
        if "업무추진비" in heading:
            found_year = re.search(r"(20\d{2})\s*[년.]", heading)
            if found_year:
                year = found_year.group(1)
        names = [re.sub(r"\s+", "", cell) for cell in cells]
        if any("장소" in name or "가맹점" in name for name in names) and any(
            "금액" in name or "집행액" in name for name in names
        ):
            columns = {
                key: next(
                    (index for index, name in enumerate(names)
                     if any(alias in name for alias in wants)), -1
                )
                for key, wants in aliases.items()
            }
            if any(columns[key] < 0 for key in ("day", "place", "amount", "purpose")):
                raise ValueError("양천구 엑셀 필수 열을 찾지 못했어요.")
            headers += 1
            continue
        if not columns:
            continue

        def pick(key: str) -> str:
            index = columns[key]
            return cells[index].strip() if 0 <= index < len(cells) else ""

        day = pick("day")
        # 일부 부서는 표 제목에만 연도를 쓰고 각 행에는 월·일만 써요.
        if year and re.match(r"^\d{1,2}\s*[월./-]\s*\d{1,2}\s*[일.\s]", day):
            day = year + "." + day
        when, has_time = moment(day, pick("time"))
        name = pick("place")
        amount = local.number(pick("amount").split(".")[0])
        if (
            when is None or not since <= when.date() <= today
            or not name or re.fullmatch(r"[-－—–.\s]+", name)
            or re.search(r"현금|경조사|경조금|축의금|부의금", name)
            or amount is None or amount <= 0
        ):
            continue
        records.append(local.record(
            "양천구", when, has_time, name, pick("purpose"), amount,
            local.number(pick("people").split(".")[0]),
            " ".join(dict.fromkeys(value for value in (dept, pick("user")) if value)),
            ["양천구"],
        ))
    if not headers:
        raise ValueError("양천구 엑셀 머리글을 찾지 못했어요.")
    return records


def attachment_format(path: str) -> str:
    """실제 저장 파일명의 확장자로 지원 여부와 건너뜀 수를 나눠요."""
    query = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)
    filename = query.get("streFileNm", [""])[0]
    return filename.rsplit(".", 1)[-1].lower() if "." in filename else "unknown"


def attachment_rows(data: bytes, kind: str) -> list[list[str]]:
    """xlsx는 공통 도우미, xls는 설치돼 있을 때만 xlrd로 읽어요."""
    if kind == "xlsx":
        return local.xlsx_rows(data)
    if kind != "xls" or xlrd is None:
        raise ValueError("양천구 첨부 형식을 읽을 수 없어요.")
    # 확장자만 .xls 이고 실제로는 엑셀이 아닌 첨부가 섞여 있어서, 못 여는 파일은 건너뛰어요.
    try:
        workbook = xlrd.open_workbook(file_contents=data)
    except (xlrd.XLRDError, xlrd.compdoc.CompDocError) as error:
        raise ValueError("양천구 .xls 첨부를 열 수 없어요.") from error
    rows = []
    for sheet in workbook.sheets():
        for index in range(sheet.nrows):
            rows.append([str(value).strip() for value in sheet.row_values(index)])
    return rows


def post_records(
    post: tuple[str, str], since: datetime.date, today: datetime.date
) -> tuple[list[dict], int, collections.Counter]:
    """엑셀만 읽고 PDF·HWP 등은 형식별 건너뜀 수에 포함해요."""
    post_id, dept = post
    article_url = BOARD + "View.do?cbIdx=397&bcIdx=" + post_id
    try:
        article = download(article_url).decode("utf-8")
    except DOWNLOAD_ERRORS:
        return [], 0, collections.Counter({"failed": 1})
    paths = list(dict.fromkeys(
        html.unescape(path)
        for path in re.findall(r'''href=["'](/common/board/Download\.do[^"']+)''', article)
    ))
    if not paths:
        return [], 0, collections.Counter({"no_file": 1})
    records = []
    fetched = 0
    skipped = collections.Counter()
    for path in paths:
        kind = attachment_format(path)
        if kind not in ("xlsx", "xls") or kind == "xls" and xlrd is None:
            skipped[kind] += 1
            continue
        try:
            data = download(urllib.parse.urljoin(ORIGIN, path), article_url)
        except DOWNLOAD_ERRORS:
            skipped["failed"] += 1
            continue
        try:
            parsed = expense_rows(attachment_rows(data, kind), since, today, dept)
        except (ValueError, zipfile.BadZipFile, ET.ParseError, KeyError):
            skipped[kind + " 읽기 실패"] += 1
            continue
        fetched += 1
        records.extend(parsed)
    return records, fetched, skipped


def fetch_records(since: datetime.date, today: datetime.date) -> list[dict]:
    """등록일 기준으로 부서·동 전체를 훑고 실제 사용일로 기간을 걸러요."""
    records = []
    seen = set()
    fetched = old_pages = 0
    skipped = collections.Counter()
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as executor:
        for page in range(1, local.MAX_PAGES + 1):
            try:
                page_html = download(
                    BOARD + f"List.do?cbIdx=397&pageIndex={page}"
                ).decode("utf-8")
            except DOWNLOAD_ERRORS as error:
                raise RuntimeError("양천구 업무추진비 목록을 받지 못했어요.") from error
            posts = []
            dates = []
            for row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", page_html, re.S):
                link = re.search(r"doBbsFView\(\s*'397'\s*,\s*'(\d+)'", row)
                if not link:
                    continue
                cells = local.table_rows("<tr>" + row + "</tr>")[0]
                date_cell = next(
                    (index for index, cell in enumerate(cells)
                     if re.fullmatch(r"20\d{2}\.\d{2}\.\d{2}", cell)), None
                )
                if date_cell is None or date_cell < 1:
                    raise RuntimeError("양천구 업무추진비 목록 날짜를 읽지 못했어요.")
                posted = datetime.datetime.strptime(cells[date_cell], "%Y.%m.%d").date()
                dates.append(posted)
                post_id = link.group(1)
                if post_id not in seen and posted >= since:
                    posts.append((post_id, cells[date_cell - 1]))
                seen.add(post_id)
            if not dates:
                raise RuntimeError("양천구 업무추진비 목록을 읽지 못했어요.")
            for result, success, failed in executor.map(
                lambda post: post_records(post, since, today), posts
            ):
                records.extend(result)
                fetched += success
                skipped.update(failed)
            if page % 10 == 0:
                print(
                    f"양천구 {page}쪽: 첨부 {fetched}개 처리, "
                    f"{sum(skipped.values())}개 건너뜀",
                    file=sys.stderr,
                )
            # 순서가 어긋난 글 하나 때문에 다음 부서를 놓치지 않아요.
            old_pages = old_pages + 1 if sum(day < since for day in dates) * 2 > len(dates) else 0
            if old_pages >= 2:
                break
        else:
            raise RuntimeError("양천구 업무추진비 게시판 쪽 수 한도를 넘었어요.")
    skipped_total = sum(skipped.values())
    skipped_detail = ", ".join(
        f"{kind} {count}개" for kind, count in sorted(skipped.items())
    )
    print(
        f"양천구 기록 {len(records)}건, 첨부 성공 {fetched}개, "
        f"건너뜀 {skipped_total}개"
        + (f" ({skipped_detail})" if skipped_detail else ""),
        file=sys.stderr,
    )
    # PDF·HWP 처럼 아직 못 읽는 형식은 많아도 정상이라, 받기에 실패한 파일만 10% 한도로 봐요.
    if skipped["failed"] * 10 > fetched + skipped["failed"]:
        raise RuntimeError(
            f"양천구 첨부 받기 실패가 10%를 넘었어요({skipped['failed']}/{fetched + skipped['failed']}개)."
        )
    return records
