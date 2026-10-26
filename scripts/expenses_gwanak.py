"""관악구청 업무추진비 집행내역(카드 목록)을 받아 local_expenses.py 와 같은 모양의 기록으로 바꿔요. official_picks.py 가 불러 써요.

집행장소가 '난곡다방(미성3길 31)'처럼 가게 이름 뒤 괄호에 주소를 달고 있어서, 괄호는 떼고 가게 이름만 name 으로 넘겨요.
"""
import concurrent.futures
import datetime
import re
import urllib.parse

import local_expenses

GWANAK_LIST = "https://www.gwanak.go.kr/site/gwanak/estimate/estimateList.do"
PAGE_SIZE = 100
WORKERS = 4
MAX_FAILED_SHARE = 0.1
NOT_A_STORE = re.compile(r"^[\s\-]*$|^소속\s*직원")


def store_name(place):
    # 이름 안에 괄호가 있어도('(주)리송') 주소는 늘 맨 끝이라 맨 끝 괄호 한 덩어리만 떼요.
    return re.sub(r"\s*\([^()]*\)\s*$", "", place).strip()


def parse_cards(page_html):
    # 카드(<table class="view">) 하나가 기록 하나라서 칸 이름(th)으로 값(td)을 찾아요.
    cards = []
    for table in re.findall(r'<table class="view">(.*?)</table>', page_html, re.S):
        cards.append({
            local_expenses.text(label): local_expenses.text(value)
            for label, value in re.findall(r"<th[^>]*>(.*?)</th>\s*<td[^>]*>(.*?)</td>", table, re.S)
        })
    return cards


def fetch_page(page, since, today):
    # 집행일 범위를 서버에 걸어야 24개월치만 받아요(전체는 21만 건).
    body = urllib.parse.urlencode({
        "pageIndex": page,
        "recordCountPerPage": PAGE_SIZE,
        "searchCondition3": since.isoformat(),
        "searchCondition4": today.isoformat(),
    }).encode()
    return local_expenses.fetch(GWANAK_LIST, body).decode("utf-8")


def fetch_page_once_more(page, since, today):
    try:
        return fetch_page(page, since, today)
    except OSError:
        try:
            return fetch_page(page, since, today)
        except OSError:
            return None


def to_record(card):
    try:
        moment = datetime.datetime.strptime(card["집행일시"][:16], "%Y-%m-%d %H:%M")
    except (KeyError, ValueError):
        return None
    purpose = card.get("집행내역", "")
    name = store_name(card.get("집행장소", ""))
    # 경조사비·직원 이름만 적힌 줄은 가게가 아니라서 빼요.
    if "경조" in purpose or NOT_A_STORE.search(name):
        return None
    return local_expenses.record(
        "관악구", moment, True, name, purpose,
        local_expenses.number(card.get("집행금액(원)", "")), local_expenses.number(card.get("대상인원수(명)", "")),
        " ".join(part for part in (card.get("집행부서", ""), card.get("사용자", "")) if part), ["관악구"],
    )


def fetch_records(since, today):
    first = fetch_page(1, since, today)
    count = re.search(r"건수\s*:\s*<em>([\d,]+)</em>", first)
    if not count:
        raise RuntimeError("관악구 업무추진비 건수를 읽지 못했어요. 화면 구조가 바뀌었는지 확인해 주세요.")
    total = int(count.group(1).replace(",", ""))
    pages = -(-total // PAGE_SIZE)
    htmls = [first]
    with concurrent.futures.ThreadPoolExecutor(max_workers=WORKERS) as pool:
        htmls += list(pool.map(lambda page: fetch_page_once_more(page, since, today), range(2, pages + 1)))
    failed = sum(1 for page_html in htmls if page_html is None)
    if failed > pages * MAX_FAILED_SHARE:
        raise RuntimeError(f"관악구 업무추진비 {pages}쪽 중 {failed}쪽을 받지 못했어요.")
    records, cards = [], 0
    for page_html in htmls:
        if page_html is None:
            continue
        for card in parse_cards(page_html):
            cards += 1
            found = to_record(card)
            if found:
                records.append(found)
    # 받은 카드 수가 건수와 크게 다르면 표 모양이 바뀐 거라서 멈춰요.
    if cards < (total - failed * PAGE_SIZE) * (1 - MAX_FAILED_SHARE):
        raise RuntimeError(f"관악구 업무추진비 {total:,}건 중 {cards:,}건만 읽었어요. 화면 구조가 바뀌었는지 확인해 주세요.")
    return records
