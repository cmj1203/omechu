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
3. 위치 칸에 동네(예: `강남역`, `전주시청`)를 적거나 비워 두고 **주변 맛집 찾기**를 눌러요. 비워 두면 브라우저가 현재 위치를 써도 되는지 물어봐요.
4. 마음에 안 들면 **다시 추천받기**, 싫은 메뉴는 **이 메뉴 빼기**를 눌러요.

## 📌 주요 기능

| 기능 | 설명 |
|------|------|
| 🍜 메뉴 추천 | 종류 · 나라 조건에 맞는 메뉴를 골라 줘요. 간식 · 술은 나라 구분 없이 추천해요 |
| 🔁 겹치지 않게 | 최근에 나온 5개는 다시 안 나와요. '이 메뉴 빼기'로 뺀 메뉴는 이 기기에만 기억하고 '다시 넣기'로 되돌려요 |
| 🍽️ 주변 식당 | 추천 메뉴를 파는 가까운 식당과 도보 시간을 보여 줘요. 2km 안에 없으면 5km까지 넓혀 찾아요 |
| 📤 공유하기 | 기기의 공유 창(카톡 등)을 열고, 공유 창이 없는 브라우저에서는 내용을 복사해요 |
| 🔐 관리자 화면 | 메뉴 추가 · 수정 · 삭제, 검색어 미리보기, 폐업 · 엉뚱한 가게 숨기기 |

## 🍽️ 추천은 이렇게 해요

1. 조건에 맞는 메뉴 중 하나를 골라요.
2. 그 메뉴의 **검색어**가 이름에 들어간 식당을 반경 2km 안에서 찾고, 가까운 3곳 중 한 곳을 **추천 식당**으로 골라요.
3. 못 찾으면 차례로 넓혀요: 같은 조건의 다른 메뉴 가게 → 5km까지 넓혀 찾기 → 같은 종류의 가게(예: 근처 일식당, 술집). 넓혀 찾았으면 화면에 그렇다고 알려 줘요.
4. **조건에 맞는 다른 가까운 곳**에는 고른 조건에 맞는 모든 메뉴의 가게를 가까운 순으로 보여 주고, 어떤 메뉴로 맞았는지 표시해요.
5. 도보 시간은 직선거리로 어림한 값이에요 (직선거리 × 1.3 ÷ 분당 67m). 정확한 길은 **카카오맵 길찾기** 버튼으로 봐요.
6. 위치 권한을 이미 허용했거나 위치 칸에 동네를 적어 두면, 메뉴를 추천할 때 식당도 바로 같이 추천해요.

식당은 우리 DB에 넣어 둔 두 가지 목록에서 찾아요. DB가 멈춰 있으면 OpenStreetMap 공개 서버로 대신 찾아요.

| 출처 | 가게 수 | 설명 |
|------|------|------|
| [OpenStreetMap](https://www.openstreetmap.org/copyright) | 약 10만 곳 | 한국의 식당 · 카페 · 술집 · 빵집 |
| [소상공인시장진흥공단 상가(상권)정보](https://www.data.go.kr/data/15083033/fileData.do) | 약 29만 곳 | 메뉴 검색어가 이름에 들어간 음식점만. OpenStreetMap에 이미 있는 가게, 구내식당 · 유흥 주점은 빼요 |

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

GitHub Actions가 매달 자동으로 두 출처의 식당 정보를 다시 받아 DB를 새로 채워요. 가져오는 동안에도 기존 정보로 계속 추천돼요.

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

- 메뉴 · 식당 · 숨긴 가게 보기: 누구나
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
7. 매달 자동 새로고침을 쓰려면 저장소 Settings → Secrets and variables → Actions 에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`를 넣어요.

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
```

- OpenStreetMap: 식당 · 카페 · 술집 · 빵집만 골라 `places` 표를 새로 채워요.
- 상가정보: 메뉴 검색어에 걸리는 음식점만 골라 더해요. 구내식당 · 유흥 주점은 빼고, OpenStreetMap에 같은 가게(150m 안의 같은 이름)가 있으면 올리지 않아요.
- 두 출처는 `places.source`로 나눠서, 각 스크립트는 자기 출처의 오래된 가게만 지워요.

</details>

---

식당 정보 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 기여자, [소상공인시장진흥공단 상가(상권)정보](https://www.data.go.kr/data/15083033/fileData.do) (공공데이터포털)

예전 버전(JSP + MySQL, 학교 주변 맛집 추천)은 [lllllIIlI/jsp](https://github.com/lllllIIlI/jsp)에 있어요.
