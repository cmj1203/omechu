# 🍽️ 오메추 (오늘 메뉴 추천)

오늘 뭐 먹지? 조건을 고르면 메뉴를 추천하고, 그 메뉴를 파는 **주변 식당**까지 찾아 주는 웹사이트예요.

🔗 **https://cmj1203.github.io/omechu/** (회원가입 · 설치 없이 바로 써요)

| 여기로 가세요 | 이런 분 |
|------|------|
| [바로 써 보기](#-바로-써-보기) | 그냥 메뉴 추천을 받고 싶어요 |
| [내 컴퓨터에서 실행하기](#️-내-컴퓨터에서-실행하기) | 코드를 내려받아 돌려 보고 싶어요 |
| [식당 정보 새로고침](#-식당-정보-새로고침) | 식당 정보가 언제 · 어떻게 바뀌는지 궁금해요 |
| [알아 두면 좋은 것](#-알아-두면-좋은-것) | 정확도 · 한계가 궁금해요 |
| [개발자용 자세한 정보](#️-개발자용-자세한-정보) | 파일 구조 · DB · 직접 운영하는 법 |

---

## 🚀 바로 써 보기

1. 휴대폰이나 컴퓨터 브라우저에서 **https://cmj1203.github.io/omechu/** 를 열어요.
2. 종류(식사 · 간식 · 술)와 나라를 고르고 **추천받기**를 눌러요.
3. 위치 칸에 동네(예: `강남역`, `전주시청`)를 적고 **주변 맛집 찾기**를 눌러요. 지금 있는 곳에서 찾으려면 **현재 위치로 찾기**를 누르고 브라우저의 위치 권한을 허용해요.
4. 마음에 안 들면 **다시 추천받기**, 싫은 메뉴는 **이 메뉴 빼기**를 눌러요.

## 📌 주요 기능

| 기능 | 설명 |
|------|------|
| 🍜 메뉴 추천 | 종류 · 나라 조건에 맞는 메뉴를 골라 줘요. 간식 · 술은 나라 구분 없이 추천해요 |
| 🔁 겹치지 않게 | 최근에 나온 5개는 다시 안 나와요. '이 메뉴 빼기'로 뺀 메뉴는 이 기기에만 기억하고 '다시 넣기'로 되돌려요 |
| 🍽️ 주변 식당 | 추천 메뉴를 파는 가까운 식당과 도보 시간을 보여 줘요. 2km 안에 없으면 5km까지 넓혀 찾아요. 공무원 맛집과 같은 가게에는 '공무원 단골 · N번' 배지가 붙어요 |
| 📤 공유하기 | 기기의 공유 창(카톡 등)을 열고, 공유 창이 없는 브라우저에서는 내용을 복사해요 |
| 🏛️ 공무원 맛집 | 서울시청 공무원들이 업무추진비로 자주 간 식당 TOP 30과, 위치를 넣으면 그 근처 공무원 맛집. 1인 가격(1.5만·2만·3만 원 이하)으로 거르고, 점심·저녁에 많이 간 순으로도 봐요 ([아래 설명](#️-공무원-맛집은-이렇게-골라요)) |
| 🗳️ 같이 정하기 | 추천 메뉴 아래 '친구랑 같이 정하기'를 누르면 후보 메뉴 투표 링크를 만들어요. 링크를 받은 사람이 투표하면 결과가 바로 보여요(24시간 뒤 마감) |
| 🔐 관리자 화면 | 메뉴 추가 · 수정 · 삭제, 검색어 미리보기, 폐업 · 엉뚱한 가게 숨기기 |

## 🍽️ 추천은 이렇게 해요

1. 조건에 맞는 메뉴 중 하나를 골라요.
2. 그 메뉴의 **검색어**가 이름에 들어간 식당을 반경 2km 안에서 찾고, 가까운 3곳 중 한 곳을 **추천 식당**으로 골라요.
3. 못 찾으면 차례로 넓혀요: 같은 조건의 다른 메뉴 가게 → 5km까지 넓혀 찾기 → 같은 종류의 가게(예: 근처 일식당, 술집). 넓혀 찾았으면 화면에 그렇다고 알려 줘요.
4. **조건에 맞는 다른 가까운 곳**에는 고른 조건에 맞는 모든 메뉴의 가게를 가까운 순으로 보여 주고, 어떤 메뉴로 맞았는지 표시해요.
5. 도보 시간은 직선거리로 어림한 값이에요 (직선거리 × 1.3 ÷ 분당 67m). 정확한 길은 **카카오맵 길찾기** 버튼으로 봐요.
6. 찾은 식당이 공무원 맛집과 같은 가게(상가정보 번호가 같거나, 40m 안에서 이름이 겹치는 곳)면 '공무원 단골 · N번' 배지를 붙여요. 누르면 공무원 맛집 탭으로 가요.
7. 위치 권한을 이미 허용했거나 위치 칸에 동네를 적어 두면, 메뉴를 추천할 때 식당도 바로 같이 추천해요.

식당은 우리 DB에 넣어 둔 두 가지 목록에서 찾아요. DB가 멈춰 있으면 OpenStreetMap 공개 서버로 대신 찾아요.

| 출처 | 가게 수 | 설명 |
|------|------|------|
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | 약 10만 곳 | 한국의 식당 · 카페 · 술집 · 빵집 |
| [소상공인시장진흥공단 상가(상권)정보](https://www.data.go.kr/data/15083033/fileData.do) | 약 29만 곳 | 메뉴 검색어가 이름에 들어간 음식점만. OpenStreetMap에 이미 있는 가게, 구내식당 · 유흥 주점은 빼요 |

## 🏛️ 공무원 맛집은 이렇게 골라요

1. 네 기관이 공개하는 업무추진비 집행내역을 받아요.
   - [서울시 본청](https://data.seoul.go.kr/dataList/OA-22156/S/1/datasetView.do)(시장단 · 4급 부서장 이상, OpenAPI): 사용 장소가 `잼배옥(중구 서소문동 64-4)`처럼 가게 이름과 주소로 적혀 있어요.
   - [은평구](https://www.ep.go.kr/www/selectJobPrtnCtWebList.do?key=666)(구청 홈페이지 표), [서대문구](https://www.sdm.go.kr/admininfo/budget/openmoney.do)(월별 엑셀), [행정안전부](https://www.mois.go.kr/frt/bbs/type001/commonSelectBoardList.do?bbsId=BBSMSTR_000000000187)(국별 첨부 엑셀): 가게 이름만 있어요.
2. 최근 24개월의 식사 관련 집행기록을 골라 상가(상권)정보의 음식점과 이어요. 서울시 본청은 주소(도로명 · 지번)와 이름으로, 나머지는 그 구(행정안전부는 세종시 · 종로구) 안에서 이름이 하나로 정해질 때만 이어요. '○○ 신촌점'처럼 지점이 다르면 잇지 않아요. 카페 · 빵집 · 구내식당 · 유흥 주점과 상품권 · 다과 구입은 빼고, 가게를 하나로 특정할 수 없으면 집계하지 않아요.
3. 가게별로 방문 기록 수, 이용 부서 수, 1인당 집행금액 평균(금액 ÷ 공개된 인원), 점심(11시 이상 15시 미만) · 저녁(17시 이후) 기록 수, 최근 이용일을 모아요. 기록이 2건 이상인 곳만 보여 줘요. 결제 기록 기준이라 실제 방문 횟수나 맛을 보증하지는 않아요.
4. 작성자 이름 같은 개인정보는 저장하지 않아요.
5. 화면에서는 1인 가격(1.5만·2만·3만 원 이하)으로 거를 수 있어요. TOP 30 순서는 많이 간 순·점심에 많이 간 순·저녁에 많이 간 순 중에 고르고, 처음 열 때는 지금 시각에 맞춰요(오전 10시~오후 3시는 점심, 오후 4시~밤 11시는 저녁).

| 알아 둘 점 | 설명 |
|------|------|
| 어디에 많아요? | 서울시청 · 광화문 · 무교동 · 을지로, 은평구, 서대문구, 정부세종청사 근처에 몰려 있어요. 다른 동네에서는 근처 결과가 적을 수 있어요 |
| 얼마나 이어져요? | 2026년 10월 14일 기준 네 기관 기록 22만 3천여 건 중 최근 24개월 식사 관련 기록 101,424건을 골랐고, 57,186건(56.4%)을 가게와 연결했어요(서울시 본청 38,439 · 은평구 10,659 · 서대문구 7,599 · 행정안전부 489건). 기록이 2건 이상인 가게는 2,644곳이에요 |
| 언제 바뀌어요? | 업무추진비는 집행 다음 달에 공개되고, 매달 자동 새로고침 때 함께 다시 모아요. 서대문구 기록은 시간이 없어서 점심 · 저녁 횟수에는 빠져요. 기관 홈페이지 하나라도 못 읽으면 그달은 지우지 않고 지난 목록을 그대로 둬요 |

## ⚙️ 내 컴퓨터에서 실행하기

필요한 것은 `git`과 `python3`뿐이에요 (맥에는 보통 깔려 있어요). 빌드나 `npm install`은 필요 없어요.

```
git clone https://github.com/cmj1203/omechu.git
cd omechu
python3 -m http.server 8000
```

브라우저에서 http://localhost:8000 을 열어요. (8000번을 이미 쓰고 있으면 다른 숫자를 쓰면 돼요)

- 그냥 열면 이 사이트가 쓰는 DB에 연결돼서 메뉴와 식당이 바로 나와요. 브라우저에 들어 있는 키는 읽기만 되는 공개 키라 괜찮아요.
- 코드를 고친 뒤에는 브라우저를 새로고침하면 바로 보여요.
- 관리자 화면(`admin.html`)은 등록된 관리자 계정만 쓸 수 있어요.

## 🔄 식당 정보 새로고침

GitHub Actions가 매달 자동으로 두 출처의 식당 정보와 공무원 맛집을 다시 받아 DB를 새로 채워요. 가져오는 동안에도 기존 정보로 계속 추천돼요.

| 항목 | 내용 |
|------|------|
| 언제 | 한국 시간 매달 **2일 새벽 3시** (= 세계 표준시 UTC 매달 1일 18시) |
| 설정 | `.github/workflows/refresh-places.yml` 의 `cron: "0 18 1 * *"` |
| 걸리는 시간 | 약 12분 |
| 결과 보기 | 저장소 **Actions** 탭 → '식당 정보 새로고침' (초록 체크면 성공) |
| 바로 돌리기 | Actions 탭 → '식당 정보 새로고침' → **Run workflow** |

> **왜 1일이 아니라 2일이에요?** GitHub의 예약 시간(cron)은 한국 시간이 아니라 세계 표준시(UTC)로 적어요. UTC 1일 18시는 한국 시간(UTC보다 9시간 빠름)으로 다음 날인 2일 새벽 3시예요. 사이트를 쓰는 사람이 거의 없는 새벽에 돌리려고 이 시각으로 정했어요.

안전장치: 새로 받은 가게가 이전보다 20% 넘게 적으면 파일이 잘못된 것으로 보고 기존 가게를 지우지 않아요. 두 출처는 따로 관리해서, 한쪽을 새로 가져와도 다른 쪽 가게는 지워지지 않아요.

## ❓ 알아 두면 좋은 것

| 궁금한 점 | 답 |
|------|------|
| 식당 정보는 얼마나 새것이에요? | OpenStreetMap은 매달, 상가정보는 분기(3개월)마다 새로 나와요. 문 닫은 가게가 남아 있으면 관리자 화면에서 숨길 수 있어요 |
| 지방에서도 잘 찾아져요? | 메뉴 149개 중 2km 안에 가게가 하나도 없는 메뉴는 강남역 13개, 춘천시청 36개, 전주시청 43개, 세종시청 52개예요 (2026년 10월 기준). 그때는 다른 메뉴 가게나 비슷한 종류의 가게를 추천해요 |
| 왜 어떤 가게는 안 나와요? | 가게 이름에 메뉴 검색어가 들어 있어야 그 메뉴 가게로 찾아요. '○○식당'처럼 이름에 메뉴가 안 드러나는 가게는 잘 안 잡혀요 |
| 도보 시간이 정확해요? | 직선거리로 어림한 값이에요. 실제 길은 **카카오맵 길찾기** 버튼으로 확인하세요 |
| 현재 위치가 안 잡혀요 | 브라우저의 위치 권한을 허용하거나, 위치 칸에 동네 이름을 적으면 돼요 |
| 자동 새로고침이 멈췄어요 | 저장소에 60일 동안 변경이 없으면 GitHub가 예약 실행을 멈춰요. Actions 탭에서 다시 켜거나 Run workflow로 바로 돌리면 돼요 |
| 메뉴를 새로 넣었는데 가게가 적어요 | 새 메뉴의 상가정보 가게는 다음 새로고침 때 들어와요. 바로 넣으려면 Run workflow로 돌리면 돼요 |

---

## 🛠️ 개발자용 자세한 정보

아래 제목을 누르면 펼쳐져요.

<details>
<summary><b>💻 사용 기술</b></summary>

| 분류 | 기술 |
|------|------|
| 화면 | HTML, CSS, JavaScript (빌드 도구 없음) |
| DB · 로그인 | Supabase (PostgreSQL, Auth, RLS) |
| 식당 · 지도 | OpenStreetMap (Overpass, Nominatim), 소상공인시장진흥공단 상가(상권)정보, 카카오맵 · 구글 지도 링크 |
| 배포 · 자동 작업 | GitHub Pages, GitHub Actions |

화면의 색 · 글자 · 간격 규칙은 [DESIGN.md](DESIGN.md)에 있어요.

</details>

<details>
<summary><b>📁 파일 구조</b></summary>

| 파일 | 설명 |
|------|------|
| `index.html`, `js/app.js` | 메뉴 추천 화면 |
| `js/menus.js`, `data/menus.json` | 메뉴 불러오기 (DB에 연결이 안 되면 기본 목록 사용) |
| `js/nearby.js` | 주변 식당 찾기의 시작점 |
| `js/nearby-location.js` | 현재 위치, 동네 이름 → 좌표 |
| `js/nearby-restaurant-search.js` | 추천할 식당 고르기 (DB 먼저, 안 되면 예비 검색) |
| `js/nearby-database.js` | 식당 DB(Supabase) 검색, 반경과 도보 시간 계산 |
| `js/nearby-overpass.js` | DB가 안 될 때 OpenStreetMap 공개 서버로 찾는 예비 검색 |
| `js/nearby-menu-matching.js` | 가게가 메뉴와 맞는지 판단 (가게 종류, 검색어 · 제외어) |
| `js/nearby-renderer.js` | 추천 카드, 다른 가까운 곳 목록, 지도 링크 그리기 |
| `admin.html`, `js/admin.js` | 관리자 로그인과 메뉴 · 숨긴 가게 관리 |
| `js/supabase.js` | Supabase 주소와 공개(publishable) 키 |
| `css/style.css` | 화면 스타일 |
| `supabase/migrations/` | DB 표, 권한(RLS), 기본 메뉴, 식당 검색 함수 |
| `scripts/import-places.sh`, `scripts/osm_to_places.py` | OpenStreetMap 식당을 DB에 (다시) 넣기 |
| `scripts/import-sbiz-places.sh`, `scripts/sbiz_to_places.py` | 상가(상권)정보 음식점을 DB에 더하기 |
| `official.html`, `js/official.js` | 공무원 맛집 화면 |
| `scripts/import-official-picks.sh`, `scripts/official_picks.py` | 업무추진비에서 공무원 맛집을 모아 DB에 넣기 |
| `scripts/local_expenses.py` | 은평구 · 서대문구 · 행정안전부 업무추진비 받기 (서대문구 엑셀은 `xlrd` 필요) |
| `vote.html`, `js/vote.js`, `css/vote.css` | 같이 정하기(메뉴 투표) 화면 |
| `.github/workflows/refresh-places.yml` | 매달 자동 새로고침 |

</details>

<details>
<summary><b>📊 데이터베이스</b></summary>

**`menus` (메뉴)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | bigint | 번호 (자동) |
| `name` | text | 메뉴 이름 (중복 불가) |
| `kind` | text | 종류: 식사 · 간식 · 술 |
| `cuisine` | text | 나라: 한식 · 중식 · 일식 · 양식 · 아시아 |
| `search_terms` | text[] | 식당을 찾을 검색어 (예: 짜장면 → 짜장, 반점, 중화). 비우면 메뉴 이름으로 찾아요 |
| `exclude_terms` | text[] | 제외어: 가게 이름에서 이 말 속에 든 검색어는 안 쳐요 (예: 커리 메뉴에서 '아우어베이커리') |

**`places` (식당)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `osm_id` | text | OpenStreetMap 번호 (상가정보 가게는 `sb` + 상가업소번호) |
| `source` | text | 어디서 가져왔는지: `osm` (OpenStreetMap) · `sbiz` (상가정보) |
| `name` | text | 가게 이름 |
| `amenity` / `shop` | text | 가게 종류 (restaurant, cafe, bar, bakery 등) |
| `cuisine` | text | 음식 종류 (있을 때만) |
| `phone`, `address` | text | 전화, 주소 (있을 때만) |
| `lat`, `lng`, `location` | 좌표 | 위치 (거리 계산용 색인) |

**`official_picks` (공무원 맛집)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `place_key` | text | 상가정보 가게 번호 (`sb` + 상가업소번호) |
| `name`, `address`, `category` | text | 가게 이름, 주소, 업종 (예: 백반/한정식) |
| `lat`, `lng`, `location` | 좌표 | 위치 (근처 찾기용 색인) |
| `visits`, `departments` | integer | 최근 2년 업무추진비로 간 횟수, 간 부서 수 |
| `avg_per_person` | integer | 1인당 평균 금액(원, 인원을 알 때만) |
| `lunch_visits`, `dinner_visits` | integer | 점심(11~15시) · 저녁(17시~) 횟수 |
| `last_visit` | date | 최근 방문일 |
| `agencies` | text | 기록을 낸 기관 (예: `서울시 본청, 은평구`) |

근처 찾기는 `official_picks_near(p_lat, p_lng, p_radius, p_max_price)` 함수로 해요 (가까운 순 30곳, 반경 최대 5km, 1인 가격 상한은 빼도 돼요). 메뉴 추천의 식당 검색(`nearby_places`)은 같은 가게면 `official_visits`(공무원 단골 횟수)를 같이 돌려줘요.

**`menu_polls` · `menu_poll_votes` (같이 정하기)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `menu_polls.options` | text[] | 후보 메뉴 2~5개 (각 1~30자) |
| `menu_polls.expires_at` | timestamptz | 마감 시각 (만든 뒤 24시간) |
| `menu_poll_votes.voter` | text | 브라우저에 저장한 무작위 번호 (한 투표에 한 번만) |
| `menu_poll_votes.option_index` | integer | 고른 후보 번호 |

누구나 투표를 만들고 투표할 수 있지만, 고치거나 지울 수는 없어요. 결과는 `menu_poll_results(p_poll)` 함수로 세요.

**`hidden_places` (관리자가 숨긴 가게)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `osm_id` | text | 숨긴 가게의 번호 (식당 정보를 새로 가져와도 그대로 숨겨져요) |
| `name`, `address` | text | 숨길 때의 가게 이름과 주소 (관리자 화면에 보여 주기용) |
| `hidden_at` | timestamptz | 숨긴 시각 |

**`admins` (관리자)**

| 필드 | 타입 | 설명 |
|------|------|------|
| `user_id` | uuid | 관리자로 지정된 Supabase 로그인 계정 |

**권한 (RLS)**

- 메뉴 · 식당 · 공무원 맛집 · 숨긴 가게 보기: 누구나 (공무원 맛집은 가져오기 스크립트만 써요)
- 메뉴 추가 · 수정 · 삭제, 가게 숨기기 · 다시 보이기: `admins`에 등록된 계정만
- 공개 키(publishable)는 브라우저에 보여도 괜찮아요. 쓰기 권한은 DB 정책이 막아요.
- DB가 멈춰 공개 서버로 찾을 때는 숨긴 가게도 나올 수 있어요.

</details>

<details>
<summary><b>🏗️ 내 Supabase로 따로 운영하기</b></summary>

1. [Supabase](https://supabase.com)에서 프로젝트를 만들어요.
2. `js/supabase.js`의 주소와 공개(publishable) 키를 내 프로젝트 것으로 바꿔요.
3. `.env.local` 파일을 만들고 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_PASSWORD`를 적어요. 이 파일은 git에 올라가지 않아요. 비밀 값은 여기에만 둬요.
4. 표와 기본 메뉴를 만들어요.
   ```
   supabase login
   supabase db push --project-ref <프로젝트 ref>
   ```
5. 식당 정보를 채워요 (아래 '식당 정보 직접 가져오기').
6. 관리자로 쓸 계정을 Supabase Authentication에서 만들고, SQL Editor에서 실행해요.
   ```
   insert into public.admins (user_id) values ('<계정 uuid>');
   ```
7. 매달 자동 새로고침을 쓰려면 저장소 Settings → Secrets and variables → Actions 에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SEOUL_OPENAPI_KEY`를 넣어요. `SEOUL_OPENAPI_KEY`는 [서울 열린데이터광장](https://data.seoul.go.kr)에서 무료로 받는 인증키예요(공무원 맛집용, `.env.local`에도 적어요).

새 표나 권한은 `supabase/migrations/`에 SQL 파일을 추가하고 `supabase db push` 하면 돼요.

</details>

<details>
<summary><b>📥 식당 정보 직접 가져오기</b></summary>

`.env.local`에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`가 있어야 해요. 상가정보 스크립트는 Python 3.11 이상이 필요해요.

```
brew install osmium-tool                   # 처음 한 번
./scripts/import-places.sh                 # OpenStreetMap 식당을 DB에 새로 채우기 (지도 파일 약 290MB)
./scripts/import-sbiz-places.sh            # 상가정보 음식점 더하기 (파일 약 350MB)
DRY_RUN=1 ./scripts/import-places.sh       # 시험: 내려받고 고르기만 (DB는 안 건드림)
DRY_RUN=1 ./scripts/import-sbiz-places.sh  # 시험: 올릴 가게 수만 세기
./scripts/import-official-picks.sh         # 공무원 맛집 다시 모으기 (SEOUL_OPENAPI_KEY 필요)
```

- OpenStreetMap: 식당 · 카페 · 술집 · 빵집만 골라 `places` 표를 새로 채워요.
- 상가정보: 메뉴 검색어에 걸리는 음식점만 골라 더해요. 구내식당 · 유흥 주점은 빼고, OpenStreetMap에 같은 가게(150m 안의 같은 이름)가 있으면 올리지 않아요.
- 두 출처는 `places.source`로 나눠서, 각 스크립트는 자기 출처의 오래된 가게만 지워요.

</details>

---

식당 정보 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 기여자, [소상공인시장진흥공단 상가(상권)정보](https://www.data.go.kr/data/15083033/fileData.do) (공공데이터포털), [서울시 본청 업무추진비](https://data.seoul.go.kr/dataList/OA-22156/S/1/datasetView.do) (서울 열린데이터광장)

예전 버전(JSP + MySQL, 학교 주변 맛집 추천)은 [lllllIIlI/jsp](https://github.com/lllllIIlI/jsp)에 있어요.
