# 🍽️ 오메추 (오늘 메뉴 추천)

오늘 뭐 먹지? 조건을 고르면 메뉴를 추천하고, 그 메뉴를 파는 **주변 맛집**을 지도에서 찾아 주는 웹사이트예요.

🔗 **사이트: https://cmj1203.github.io/omechu/**

> 예전 버전(JSP + MySQL, 학교 주변 맛집 추천)은 [lllllIIlI/jsp](https://github.com/lllllIIlI/jsp)에 있어요.

---

## 📌 주요 기능

- 🍜 조건(종류 · 나라 · 시간)을 고르면 오늘의 메뉴를 추천
- 🍽️ 추천 메뉴를 파는 **주변 식당 추천**과 **걸리는 시간(도보)**: 현재 위치나 입력한 동네 기준 (API 키 필요 없음)
- 🔐 관리자 페이지: 로그인해서 메뉴 추가 · 수정 · 삭제

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

1. 조건에 맞는 메뉴를 고른 뒤, 그 메뉴의 **검색어**가 이름에 들어간 식당을 반경 2km 안에서 찾아요. 우리 DB에 넣어 둔 OpenStreetMap 한국 식당 목록(약 10만 곳)에서 찾고, DB가 멈춰 있으면 OpenStreetMap 공개 서버로 찾아요.
2. 오늘의 메뉴를 파는 가까운 3곳 중 한 곳을 **추천 식당**으로 골라요. 없으면 같은 조건에 맞는 다른 메뉴의 가게를, 그것도 없으면 같은 종류의 가게(예: 근처 일식당, 술집)를 골라요.
3. **조건에 맞는 다른 가까운 곳**에는 고른 조건(종류 · 나라 · 시간)에 맞는 모든 메뉴의 가게를 가까운 순으로 보여 주고, 어떤 메뉴로 맞았는지 표시해요.
4. 도보 시간은 직선거리로 어림한 값이에요 (직선거리 × 1.3 ÷ 분당 67m). 정확한 길은 **카카오맵 길찾기** 버튼으로 볼 수 있어요.
5. 위치 권한을 이미 허용했거나 위치 칸에 동네를 적어 두면, 메뉴를 추천할 때 식당도 바로 같이 추천해요.

식당 정보 © [OpenStreetMap](https://www.openstreetmap.org/copyright) 기여자

### 식당 정보 다시 가져오기 (한 달에 한 번쯤)

```
brew install osmium-tool   # 처음 한 번
./scripts/import-places.sh
```

한국 지도 파일(약 290MB)을 내려받아 식당·카페·술집만 골라 `places` 표를 새로 채워요. 가져오는 동안에도 기존 정보로 계속 추천돼요.

---

## 📊 데이터베이스

### `menus` (메뉴)

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | bigint | 번호 (자동) |
| `name` | text | 메뉴 이름 (중복 불가) |
| `kind` | text | 종류: 식사 · 간식 · 술 |
| `cuisine` | text | 나라: 한식 · 중식 · 일식 · 양식 · 아시아 |
| `party` | text[] | 어울리는 인원: 1인 · 2~4인 · 5인~ (여러 개, 지금은 추천 화면에 안 써요) |
| `times` | text[] | 어울리는 시간: 아침 · 점심 · 저녁 · 야식 (여러 개) |
| `search_terms` | text[] | 식당을 찾을 검색어 (예: 짜장면 → 짜장, 반점, 중화). 비우면 메뉴 이름으로 찾아요 |

### `places` (식당, OpenStreetMap에서 가져옴)

| 필드 | 타입 | 설명 |
|------|------|------|
| `osm_id` | text | OpenStreetMap 번호 |
| `name` | text | 가게 이름 |
| `amenity` / `shop` | text | 가게 종류 (restaurant, cafe, bar, bakery 등) |
| `cuisine` | text | 음식 종류 (있을 때만) |
| `phone`, `address` | text | 전화, 주소 (있을 때만) |
| `lat`, `lng`, `location` | 좌표 | 위치 (거리 계산용 색인) |

### `admins` (관리자)

| 필드 | 타입 | 설명 |
|------|------|------|
| `user_id` | uuid | 관리자로 지정된 Supabase 로그인 계정 |

### 🔒 권한 (RLS)

- 메뉴 보기: 누구나
- 메뉴 추가 · 수정 · 삭제: `admins`에 등록된 계정만
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
