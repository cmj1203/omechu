# 🍽️ 오메추 (오늘 메뉴 추천)

오늘 뭐 먹지? 조건을 고르면 메뉴를 추천하고, 그 메뉴를 파는 **주변 맛집**을 지도에서 찾아 주는 웹사이트예요.

🔗 **사이트: https://cmj1203.github.io/omechu/**

> 예전 버전(JSP + MySQL, 학교 주변 맛집 추천)은 [lllllIIlI/jsp](https://github.com/lllllIIlI/jsp)에 있어요.

---

## 📌 주요 기능

- 🍜 조건(종류 · 나라 · 인원 · 시간)을 고르면 오늘의 메뉴를 추천
- 📍 추천 메뉴로 주변 맛집 찾기: 현재 위치나 입력한 동네 기준으로 구글 지도를 열어요 (API 키 필요 없음)
- 🔐 관리자 페이지: 로그인해서 메뉴 추가 · 수정 · 삭제

---

## 💻 사용 기술

| 분류 | 기술 |
|------|------|
| 화면 | HTML, CSS, JavaScript (빌드 도구 없음) |
| DB · 로그인 | Supabase (PostgreSQL, Auth, RLS) |
| 지도 | 구글 지도 검색 링크 |
| 배포 | GitHub Pages |

---

## 📁 파일 구조

| 파일 | 설명 |
|------|------|
| `index.html`, `js/app.js` | 메뉴 추천 화면 |
| `js/nearby.js` | 주변 맛집 찾기 (위치 → 구글 지도) |
| `admin.html`, `js/admin.js` | 관리자 로그인과 메뉴 관리 |
| `js/supabase.js` | Supabase 주소와 공개(publishable) 키 |
| `js/menus.js` | 메뉴 불러오기 (DB에 연결이 안 되면 기본 목록 사용) |
| `data/menus.json` | 기본 메뉴 목록 |
| `supabase/migrations/` | DB 표, 권한(RLS), 기본 메뉴 |
| `css/style.css` | 화면 스타일 |

---

## 📊 데이터베이스

### `menus` (메뉴)

| 필드 | 타입 | 설명 |
|------|------|------|
| `id` | bigint | 번호 (자동) |
| `name` | text | 메뉴 이름 (중복 불가) |
| `kind` | text | 종류: 식사 · 간식 · 술 |
| `cuisine` | text | 나라: 한식 · 중식 · 일식 · 양식 · 아시아 |
| `party` | text[] | 어울리는 인원: 1인 · 2~4인 · 5인~ (여러 개) |
| `times` | text[] | 어울리는 시간: 아침 · 점심 · 저녁 · 야식 (여러 개) |

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
