"""서울시 본청 말고 다른 기관의 업무추진비를 받아 같은 모양의 기록으로 바꿔요. official_picks.py 가 불러 써요.

은평구(구청 홈페이지 표), 서대문구(월별 엑셀), 행정안전부(게시판 첨부 엑셀)는 사용 장소에 주소가 없어서,
official_picks.py 가 정해진 지역 안에서 이름이 하나뿐인 가게로만 이어 붙여요.
"""
import datetime
import html
import io
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
import zipfile

USER_AGENT = "Mozilla/5.0 (omechu official-picks import)"
EUNPYEONG_LIST = "https://www.ep.go.kr/www/selectJobPrtnCtWebList.do?key=666&pageUnit=1000&searchCnd=all&searchKrwd=&pageIndex={}"
SEODAEMUN_PAGE = "https://www.sdm.go.kr/admininfo/budget/openmoney.do"
SEODAEMUN_EXCEL = "https://www.sdm.go.kr/excelDownLoad.do?actionNm=/admininfo/budget/openmoney.do"
MOIS_LIST = "https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000187&pageIndex={}"
MOIS_ARTICLE = "https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardArticle.do?bbsId=BBSMSTR_000000000187&nttId={}"
MOIS_ORIGIN = "https://www.mois.go.kr"
MAX_PAGES = 400
XLSX_NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"


def fetch(url, data=None, referer=None):
    headers = {"User-Agent": USER_AGENT}
    if referer:
        headers["Referer"] = referer
    request = urllib.request.Request(url, data=data, headers=headers)
    # 구청 서버가 가끔 잠깐 500 을 주거나 연결을 끊거나 답을 늦게 줘서, 서버 오류·연결 실패·읽기 시간 초과만 5초 쉬고 두 번 더 불러요.
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except urllib.error.HTTPError as error:
            if error.code < 500 or attempt == 2:
                raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            # 인증서 오류는 다시 불러도 같아서 바로 넘겨요(중구는 이걸 보고 검증 없이 다시 받아요).
            if attempt == 2 or isinstance(getattr(error, "reason", None), ssl.SSLError):
                raise
        time.sleep(5)


def text(cell_html):
    return " ".join(html.unescape(re.sub(r"<[^>]+>", " ", cell_html)).split())


def table_rows(page_html):
    rows = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", page_html, re.S):
        cells = [text(cell) for cell in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        if cells:
            rows.append(cells)
    return rows


def number(value):
    digits = re.sub(r"[^0-9]", "", str(value))
    return int(digits) if digits else None


def record(agency, when, has_time, name, purpose, amount, people, dept, gus, meal=None):
    return {
        "agency": agency,
        "when": when,
        "has_time": has_time,
        "name": name.strip(),
        "location": None,
        "gus": gus,
        "purpose": purpose or "",
        "meal": meal,
        "amount": amount,
        "people": people if people and people > 0 else None,
        "dept": agency + " " + (dept or ""),
    }


def eunpyeong(since):
    """은평구청 '업무추진비 집행내역' 표를 최신 순으로 1,000줄씩 읽다가, 한 쪽의 절반 넘게 since 보다 오래되면 멈춰요.
    표는 일련번호 순이라 날짜를 잘못 적은 줄(2062년 등)이 섞여 있어서, 한 줄만 보고 멈추지 않아요."""
    records = []
    for page in range(1, MAX_PAGES + 1):
        rows = [row for row in table_rows(fetch(EUNPYEONG_LIST.format(page)).decode("utf-8")) if len(row) >= 10]
        if not rows:
            if page == 1:
                raise RuntimeError("은평구 업무추진비 표를 읽지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")
            return records
        older = 0
        for _, dept, _, people, when, place, purpose, amount, *_ in rows:
            try:
                moment = datetime.datetime.strptime(when[:16], "%Y-%m-%d %H:%M")
            except ValueError:
                continue
            older += moment.date() < since
            records.append(record("은평구", moment, True, place, purpose, number(amount), number(people), dept, ["은평구"]))
        if older * 2 > len(rows):
            return records
    raise RuntimeError("은평구 업무추진비가 너무 많아요(쪽 수 한도 초과).")


def months(since, today):
    year, month = since.year, since.month
    while (year, month) <= (today.year, today.month):
        yield year, month
        year, month = (year + 1, 1) if month == 12 else (year, month + 1)


def seodaemun(since, today):
    """서대문구청 업무추진비 화면의 '월별 엑셀 받기'를 since 달부터 이번 달까지 받아요."""
    import xlrd  # 옛 엑셀(.xls)이라 xlrd 가 필요해요.

    records = []
    for year, month in months(since, today):
        body = urllib.parse.urlencode({"searchGUBUN": "", "searchDept": "", "searchYear": year, "searchMonth": f"{month:02d}", "cp": ""}).encode()
        data = fetch(SEODAEMUN_EXCEL, body, referer=SEODAEMUN_PAGE)
        if not data.startswith(b"\xd0\xcf\x11\xe0"):
            raise RuntimeError(f"서대문구 {year}년 {month}월 엑셀을 받지 못했어요.")
        sheet = xlrd.open_workbook(file_contents=data).sheet_by_index(0)
        header = None
        for index in range(sheet.nrows):
            cells = [str(value).strip() for value in sheet.row_values(index)]
            if "장소" in cells and "집행일" in cells:
                header = index
                col = {name: position for position, name in enumerate(cells)}
                break
        if header is None:
            raise RuntimeError(f"서대문구 {year}년 {month}월 엑셀 칸 이름이 달라요.")
        for index in range(header + 1, sheet.nrows):
            row = [str(value).strip() for value in sheet.row_values(index)]
            try:
                day = datetime.datetime.strptime(row[col["집행일"]][:10], "%Y-%m-%d")
            except ValueError:
                continue
            records.append(record(
                "서대문구", day, False, row[col["장소"]], row[col["집행유형"]],
                seodaemun_amount(row[col["집행액(천원)"]]), number(row[col["집행인원"]].split(".")[0]),
                row[col["집행부서"]], ["서대문구"], meal=row[col["집행구분"]] == "식사",
            ))
    return records


def seodaemun_amount(value):
    """'집행액(천원)' 칸은 달마다 천 원 단위(250, 36.5)이거나 원 단위(36500)로 적혀 있어요.
    한 번 식사에 1만 천 원(1천만 원)은 없으니, 10000 이상은 원 단위로 봐요."""
    try:
        amount = float(str(value).replace(",", ""))
    except ValueError:
        return None
    if amount <= 0:
        return None
    return round(amount if amount >= 10000 else amount * 1000)


def xlsx_rows(data):
    archive = zipfile.ZipFile(io.BytesIO(data))
    shared = []
    if "xl/sharedStrings.xml" in archive.namelist():
        for item in ET.fromstring(archive.read("xl/sharedStrings.xml")).iter(XLSX_NS + "si"):
            shared.append("".join(node.text or "" for node in item.iter(XLSX_NS + "t")))
    rows = []
    for sheet in sorted(name for name in archive.namelist() if name.startswith("xl/worksheets/sheet")):
        for row in ET.fromstring(archive.read(sheet)).iter(XLSX_NS + "row"):
            cells = {}
            for cell in row.findall(XLSX_NS + "c"):
                column = re.sub(r"[0-9]", "", cell.get("r", ""))
                value = cell.find(XLSX_NS + "v")
                if cell.get("t") == "s" and value is not None:
                    cells[column] = shared[int(value.text)]
                elif value is not None:
                    cells[column] = value.text or ""
                else:
                    cells[column] = "".join(node.text or "" for node in cell.iter(XLSX_NS + "t"))
            width = max((column_index(column) for column in cells), default=-1) + 1
            rows.append([cells.get(column_name(position), "").strip() for position in range(width)])
    return rows


def column_index(column):
    index = 0
    for letter in column:
        index = index * 26 + ord(letter) - 64
    return index - 1


def column_name(index):
    name = ""
    index += 1
    while index:
        index, rest = divmod(index - 1, 26)
        name = chr(65 + rest) + name
    return name


def excel_moment(day, time):
    """엑셀 날짜(46205 같은 일련번호나 '2026-07-01')와 시간(0.526 같은 하루 비율이나 '12:38')을 합쳐요."""
    try:
        base = datetime.datetime(1899, 12, 30) + datetime.timedelta(days=float(day))
    except ValueError:
        base = None
        for pattern in ("%Y-%m-%d", "%Y.%m.%d", "%Y. %m. %d", "%Y.%m.%d."):
            try:
                base = datetime.datetime.strptime(day.strip(), pattern)
                break
            except ValueError:
                continue
        if base is None:
            return None, False
    try:
        return base + datetime.timedelta(days=float(time) % 1), True
    except ValueError:
        found = re.match(r"(\d{1,2}):(\d{2})", time or "")
        if found:
            return base.replace(hour=int(found.group(1)), minute=int(found.group(2))), True
    return base, False


def mois(since):
    """행정안전부 '업무추진비 사용내역' 게시판에서 since 이후 글의 첨부 엑셀(.xlsx)을 모두 읽어요."""
    records = []
    for page in range(1, MAX_PAGES + 1):
        page_html = fetch(MOIS_LIST.format(page)).decode("utf-8")
        posts = re.findall(r"<tr[^>]*>(.*?)</tr>", page_html, re.S)
        found = []
        for post in posts:
            link = re.search(r"nttId=(\d+)[^>]*>(.*?)</a>", post, re.S)
            dates = re.findall(r"(20\d\d)[.-](\d\d)[.-](\d\d)", post)
            if link and dates:
                found.append((link.group(1), text(link.group(2)), datetime.date(*map(int, dates[-1]))))
        if not found:
            if page == 1:
                raise RuntimeError("행정안전부 업무추진비 게시판을 읽지 못했어요.")
            return records
        for ntt_id, title, posted in found:
            if posted < since or "업무추진비" not in title:
                continue
            article = fetch(MOIS_ARTICLE.format(ntt_id)).decode("utf-8")
            for path in dict.fromkeys(re.findall(r"/cmm/fms/FileDown\.do\?[^\"' ]+", article)):
                data = fetch(MOIS_ORIGIN + html.unescape(path))
                if not data.startswith(b"PK"):
                    continue
                records.extend(mois_rows(xlsx_rows(data), since))
        if min(posted for _, _, posted in found) < since:
            return records
    raise RuntimeError("행정안전부 게시판 쪽 수 한도를 넘었어요.")


def mois_rows(rows, since):
    records = []
    header = None
    for index, cells in enumerate(rows):
        if any("가맹점" in cell for cell in cells) and any("사용일" in cell for cell in cells):
            header = index
            col = {name: position for position, name in enumerate(cells)}
            break
    if header is None:
        return records

    def pick(cells, *names):
        for name in col:
            if any(want in name for want in names):
                position = col[name]
                return cells[position] if position < len(cells) else ""
        return ""

    for cells in rows[header + 1:]:
        moment, has_time = excel_moment(pick(cells, "사용일"), pick(cells, "사용시간"))
        place = pick(cells, "가맹점")
        if moment is None or not place or moment.date() < since:
            continue
        records.append(record(
            "행정안전부", moment, has_time, place, pick(cells, "사용목적", "사용내용"),
            number(pick(cells, "금액").split(".")[0]), number(pick(cells, "인원").split(".")[0]),
            pick(cells, "사용자"), ["세종특별자치시", "종로구"], meal=True,
        ))
    return records
