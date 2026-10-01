# 🍽️ 오메추 (오늘 메뉴 추천)

오늘 뭐 먹지? 조건을 고르면 메뉴를 추천하고, 그 메뉴를 파는 **주변 맛집**을 지도에서 찾아 주는 웹사이트예요.

🔗 **사이트: https://cmj1203.github.io/omechu/**

> 예전 버전(JSP + MySQL, 학교 주변 맛집 추천)은 [lllllIIlI/jsp](https://github.com/lllllIIlI/jsp)에 있어요.

---

## 📌 주요 기능

- 🍜 조건(종류 · 나라)을 고르면 오늘의 메뉴를 추천 (간식 · 술은 나라 구분 없이 추천)
- 🔁 최근에 나온 5개 메뉴는 다시 안 나오고, 싫은 메뉴는 '이 메뉴 빼기'로 뺄 수 있어요 (이 기기에만 기억, '다시 넣기'로 되돌리기)
- 🍽️ 추천 메뉴를 파는 **주변 식당 추천**과 **걸리는 시간(도보)**: 현재 위치나 입력한 동네 기준 (API 키 필요 없음). 2km 안에 없으면 5km까지 넓혀 찾아요
- 📤 추천 식당 **공유하기**: 기기의 공유 창(휴대폰은 카톡 등)을 열고, 공유 창이 없거나 열리지 않는 브라우저에서는 내용을 복사
- 🔐 관리자 페이지: 로그인해서 메뉴 추가 · 수정 · 삭제, 메뉴 찾기, 검색어 미리보기(강남역 2km 안 몇 곳이 잡히는지), 폐업·엉뚱한 가게 숨기기

---

## 💻 사용 기술

| 분류 | 기술 |
|------|------|
| 화면 | HTML, CSS, JavaScript (빌드 도구 없음) |
| DB · 로그인 | Supabase (PostgreSQL, Auth, RLS) |
| 식당 · 지도 | OpenStreetMap (Overpass, Nominatim), 카카오맵 · 구글 지도 링크 |
| 배포 | GitHub Pages |

---

## 📁 파일 구조

| 파일 | 설명 |
|------|------|
| `index.html`, `js/app.js` | 메뉴 추천 화면 |
| `js/nearby.js` | 주변 식당 찾기 (위치 → OpenStreetMap 검색 → 추천 식당과 도보 시간) |
| `js/nearby-location.js` | 현재 위치, 동네 이름 → 좌표 |
| `js/nearby-restaurant-search.js` | 추천할 식당 고르기 (DB 먼저, 안 되면 예비 검색) |
| `js/nearby-database.js` | 식당 DB(Supabase) 검색, 2km 반경과 도보 시간 계산 |
| `js/nearby-overpass.js` | DB가 안 될 때 OpenStreetMap 공개 서버로 찾는 예비 검색 |
| `js/nearby-menu-matching.js` | 가게가 메뉴와 맞는지 판단 (가게 종류, 검색어·제외어) |
| `js/nearby-renderer.js` | 추천 카드, 다른 가까운 곳 목록, 지도 링크 그리기 |
| `admin.html`, `js/admin.js` | 관리자 로그인과 메뉴 관리 |
| `js/supabase.js` | Supabase 주소와 공개(publishable) 키 |
| `js/menus.js` | 메뉴 불러오기 (DB에 연결이 안 되면 기본 목록 사용) |
| `data/menus.json` | 기본 메뉴 목록 |
| `supabase/migrations/` | DB 표, 권한(RLS), 기본 메뉴, 식당 검색 함수 |
| `scripts/import-places.sh` | OpenStreetMap 한국 식당 데이터를 DB에 (다시) 넣기 |
| `scripts/osm_to_places.py` | 위 스크립트가 쓰는 변환·업로드 도구 |
| `css/style.css` | 화면 스타일 |

---

## 🍽️ 식당 추천은 이렇게 해요

1. 조건에 맞는 메뉴를 고른 뒤, 그 메뉴의 **검색어**가 이름에 들어간 식당을 반경 2km 안에서 찾아요. 2km 안에 메뉴나 조건에 맞는 가게가 없으면 5km까지 넓혀 찾고 그렇다고 알려 줘요. 관리자가 숨긴 가게는 빼요(DB가 멈춰 공개 서버로 찾을 때는 숨긴 가게도 나올 수 있어요). 이름 속 **제외어**에 든 검색어는 안 쳐요 (예: 커리 메뉴에서 '아우어베이커리'). 우리 DB에 넣어 둔 OpenStreetMap 한국 식당 목록(약 10만 곳)에서 찾고, DB가 멈춰 있으면 OpenStreetMap 공개 서버로 찾아요.
2. 오늘의 메뉴를 파는 가까운 3곳 중 한 곳을 **추천 식당**으로 골라요. 없으면 같은 조건에 맞는 다른 메뉴의 가게를, 그것도 없으면 같은 종류의 가게(예: 근처 일식당, 술집)를 골라요.
3. **조건에 맞는 다른 가까운 곳**에는 고른 조건(종류 · 나라)에 맞는 모든 메뉴의 가게를 가까운 순으로 보여 주고, 어떤 메뉴로 맞았는지 표시해요.
4. 도보 시간은 직선거리로 어림한 값이에요 (직선거리 × 1.3 ÷ 분당 67m). 정확한 길은 **카카오맵 길찾기** 버튼으로 볼 수 있어요.
5. 위치 권한을 이미 허용했거나 위치 칸에 동네를 적어 두면, 메뉴를 추천할 때 식당도 바로 같이 추천해요.

식당 정보 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 기여자

### 식당 정보 새로고침 (매달 자동)

GitHub Actions(`.github/workflows/refresh-places.yml`)가 매달 2일 새벽 3시(한국 시간)에 한국 지도 파일(약 290MB)을 내려받아 식당·카페·술집만 골라 `places` 표를 새로 채워요. 가져오는 동안에도 기존 정보로 계속 추천돼요. 새로 올린 가게가 이전보다 20% 넘게 적으면 지도 파일이 잘못된 것으로 보고 기존 가게를 지우지 않아요.

- 필요한 설정: 저장소 Settings → Secrets and variables → Actions 에 `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`
- 바로 돌리기: Actions 탭 → '식당 정보 새로고침' → Run workflow
- 저장소에 60일 동안 아무 변경이 없으면 GitHub가 예약 실행을 멈춰요. 그때는 Actions 탭에서 다시 켜면 돼요.

내 컴퓨터에서 직접 돌릴 수도 있어요.

```
brew install osmium-tool              # 처음 한 번
./scripts/import-places.sh            # DB까지 새로 채우기
DRY_RUN=1 ./scripts/import-places.sh  # 내려받고 고르기만 (DB는 안 건드림)
```

---

## 📊 데이터베이스

### `menus` (메뉴)

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | bigint | 번호 (자동) |
| `name` | text | 메뉴 이름 (중복 불가) |
| `kind` | text | 종류: 식사 · 간식 · 술 |
| `cuisine` | text | 나라: 한식 · 중식 · 일식 · 양식 · 아시아 |
| `search_terms` | text[] | 식당을 찾을 검색어 (예: 짜장면 → 짜장, 반점, 중화). 비우면 메뉴 이름으로 찾아요 |
| `exclude_terms` | text[] | 제외어: 가게 이름에서 이 말 속에 든 검색어는 안 쳐요 (예: 커리 → 베이커리) |

### `places` (식당, OpenStreetMap에서 가져옴)

| 필드 | 타입 | 설명 |
|------|------|------|
| `osm_id` | text | OpenStreetMap 번호 |
| `name` | text | 가게 이름 |
| `amenity` / `shop` | text | 가게 종류 (restaurant, cafe, bar, bakery 등) |
| `cuisine` | text | 음식 종류 (있을 때만) |
| `phone`, `address` | text | 전화, 주소 (있을 때만) |
| `lat`, `lng`, `location` | 좌표 | 위치 (거리 계산용 색인) |

### `hidden_places` (관리자가 숨긴 가게)

| 필드 | 타입 | 설명 |
|------|------|------|
| `osm_id` | text | 숨긴 가게의 OpenStreetMap 번호 (식당 정보를 새로 가져와도 그대로 숨겨져요) |
| `name`, `address` | text | 숨길 때의 가게 이름과 주소 (관리자 화면에 보여 주기용) |
| `hidden_at` | timestamptz | 숨긴 시각 |

### `admins` (관리자)

| 필드 | 타입 | 설명 |
|------|------|------|
| `user_id` | uuid | 관리자로 지정된 Supabase 로그인 계정 |

### 🔒 권한 (RLS)

- 메뉴 보기: 누구나
- 메뉴 추가 · 수정 · 삭제: `admins`에 등록된 계정만
- 숨긴 가게 보기: 누구나 (식당 검색이 빼기 위해 읽어요) · 숨기기 · 다시 보이기: `admins`에 등록된 계정만
- 공개 키(publishable)는 브라우저에 보여도 괜찮아요. 쓰기 권한은 DB 정책이 막아요.

---

## ⚙️ 내 컴퓨터에서 보기

```
cd omechu
python3 -m http.server 8000
```

브라우저에서 http://localhost:8000 을 열어요. (8000번을 이미 쓰고 있으면 다른 숫자를 쓰면 돼요)

## 🗄️ DB 바꾸기 (Supabase CLI)

```
supabase login
supabase db push --project-ref <프로젝트 ref>
```

새 표나 권한은 `supabase/migrations/`에 SQL 파일을 추가하고 `db push` 하면 돼요.
비밀 값(DB 비밀번호, 비밀 키, 관리자 비밀번호)은 `.env.local`에만 두고 git에 올리지 않아요.
