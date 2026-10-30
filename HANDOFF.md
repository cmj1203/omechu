# 이어받기 메모

다른 Claude 세션(터미널 등)이 이 작업을 이어받을 수 있게 적어 두는 문서예요. 작업할 때마다 고쳐요.

- 브랜치: `claude/serene-faraday-2f849z` (PR 아직 없음, PR은 사용자가 요청할 때만)
- 마지막 갱신: 2026-10-28
- 테스트: `npm ci && npm test`(화면), `PGHOST=… PGUSER=… PGPASSWORD=… npm run test:db`(DB). CI는 `.github/workflows/test.yml`.

## 사용자가 해야 하는 일 (코드로 못 하는 것)

1. **구글 키**: `js/place-rating.js`의 `GOOGLE_MAPS_KEY`가 비어 있음. 비어 있으면 평점·영업 상태·추천 기준 칩이 모두 꺼지고 가까운 순으로만 고름.
   키를 넣을 때 **HTTP 리퍼러 제한 + Places API 하루 할당량 상한**을 꼭 걸 것(README 8번).
2. **Supabase 회원가입 켜기**: 대시보드 Authentication에서 새 가입 허용·Email 켜기, Redirect URLs 에 `https://cmj1203.github.io/omechu/**` 추가(README 9번). 비밀번호 최소 길이도 8로(가입 화면과 같게, `config.toml`은 8로 맞춤). `supabase/config.toml`도 같게 맞춰 둠.
3. **새 마이그레이션 적용**: `supabase db push` (아래 두 파일).
4. **실제 서비스 확인(2026-10-28 맥에서 함)**: 공개 도메인에서 브랜치 파일로 열어 보니 CSP가 카카오 SDK 본체(`t1.kakaocdn.net`)를 막아 장소 검색·현재 위치 주소가 안 됐음. 다섯 HTML의 script-src 에 `https://*.kakaocdn.net` 을 더해 해결(아이폰 크기에서 현재 위치 주소 채우기·식당 추천 확인). 구글은 키가 없어 아직 못 봄. 아래는 원래 메모.
4-1. **실제 서비스로 한 번 확인**: 이 클라우드 환경은 구글·카카오·Supabase에 못 나가서 모두 가짜 응답으로만 확인함. 특히
   - CSP(`<meta http-equiv="Content-Security-Policy">`, 다섯 화면)에 막히는 실제 카카오·구글 스크립트·이미지가 없는지(브라우저 콘솔의 'Refused to …'). 막히면 그 주소를 다섯 HTML의 CSP에 더하면 됨.
   - 구글 이름·위치 맞추기(체인점 '○○점', 영어 이름 가게), `place.isOpen()` 결과.

## 기능별 정리

### 평점 추천 (`js/place-rating.js`, `js/nearby-restaurant-search.js`)
- 카카오·네이버는 평점 API가 없고 화면 긁기는 약관 위반이라 구글 Places로 정함(사용자 동의).
- 브라우저에서 Maps JavaScript API `Place.searchByText`로 이름을 찾고, 300m 안에서 이름이 서로 들어 있는 곳을 같은 가게로 봄. 같은 가게는 화면을 연 동안 캐시.
- 돌려주는 값: `{ rating(없으면 null), reviews, openNow(true/false/undefined), closedForGood }`, 구글에서 못 찾으면 `null`, 못 물어봤으면 `undefined`.
- **오메추 평점**(`omechuRating`) = `(리뷰수 × 구글평점 + 100 × 4.0) / (리뷰수 + 100)`. **추천 순서에만 쓰고 화면엔 구글 평점·리뷰 수 그대로**(사용자 요청). 리뷰 10개 미만·평점 없음은 `-`, 4.0으로 셈.
- **평점 우선(기본)**: 가까운 10곳 중 오메추 평점이 가장 높은 곳(같으면 가까운 곳). **거리 우선**: 가장 가까운 곳. 무작위 없음(사용자 10-29: 무작위 3곳 뽑기는 혼란스러워 뺌). '다른 가게'는 `shown`을 빼고 다시 고르니 그다음 순서. 둘 다 지금 문 닫은 가게(`knownClosed`)는 다른 가게가 없을 때만.
- 다른 가까운 곳 목록: 평점 우선이면 오메추 평점 순, 거리 우선이면 가까운 순, 문 닫은 가게는 맨 뒤.
- 추천 기준은 `localStorage`의 `omechu.recommendOrder`에 기억. 구글 키가 없거나 가게·메뉴 검색 목록이면 칩을 숨김. 가게·메뉴 검색 목록(최대 30곳)엔 평점을 안 붙임(비용).

### '다른 가게' (`js/nearby.js`, `searchRestaurants(..., shown)`)
- 추천 상자 가게 이름 오른쪽 단추. `shown`(placeKey 묶음)을 빼고 다시 고름. 메뉴·위치·추천 기준이 바뀌면 비움.
- 남은 게 문 닫은 가게뿐이면 처음부터 다시 고름(이미 보여 준 가게가 다시 나오면 `rememberShown`이 비우고 다시 셈).

### 위치 칸 (`index.html`, `js/nearby.js`, `js/nearby-location.js`)
- '주변 ○○ 식당 추천' 단추는 없앰(하는 일이 없었음). 위치 칸을 눌러 장소를 고르면 바로 추천.
- 현재 위치 단추는 위치 칸 안 오른쪽 아이콘(`.nearby-locate`). 현재 위치로 찾으면 카카오 `coord2Address`로 도로명 주소를 위치 칸에 넣고, 결과는 계속 '현재 위치에서 도보 …'(`pickedOrigin.label`='현재 위치', 칸 글자 비교는 `inputText`).
- 찾는 동안은 결과 자리에 '현재 위치 확인 중…'·'식당 찾는 중…'. `busy` 플래그로 위치 칸·단추를 잠금.

### 회원 (`account.html`, `js/account.js`, `js/member.js`, `20261027130000_member_places.sql`)
- 탭 세 번째가 '내 계정'(예전 '로그인'). 로그인·회원가입(비밀번호 8자 이상, 확인 메일을 쓰는 설정이면 메일 안내), 즐겨찾기·최근 본 가게 목록, 로그아웃, 탈퇴(`delete_my_account` rpc, 관리자 계정은 막음).
- 관리자는 같은 로그인. 관리자면 내 계정에 '관리자 화면' 링크. `admin.html`은 일반 회원이 와도 로그아웃시키지 않고 안내만.
- 즐겨찾기 별: 추천 상자엔 늘, 목록엔 로그인한 회원에게만. 로그인 안 했으면 로그인 안내 창.
- 최근 본 가게: 가게 이름(가게 페이지)·길찾기·지도를 열 때 `recent_places`에 upsert, 회원마다 30곳만 남김(트리거).
- 기본으로 뺄 메뉴(`excluded_menus`, 사용자 10-30): 내 계정에서 메뉴를 넣어 두면 `js/app.js` 추천에서 늘 빠짐(`excludedMenus()`), 100개까지. 메인의 '이 메뉴 빼기'는 localStorage 없이 그 화면을 연 동안만.
- 가게는 places 번호가 아니라 이름·좌표로 기억(매달 places를 새로 채워 번호가 바뀌어서).

### 보안
- `20261027120000_anon_write_limits.sql`: 가게 문제 알림 같은 가게 하루 3번·전체 한 시간 300번, 투표 한 시간 300개, 표 투표당 200표. 세는 함수는 security definer(익명이 못 읽는 줄도 세야 해서), rpc로는 못 부르게 revoke.
- supabase-js `@2.117.3`, actions `checkout`·`setup-node`·`upload-artifact`는 커밋 SHA로 고정.
- 다섯 화면에 CSP. 스크립트는 self·jsdelivr·카카오(`dapi.kakao.com`, `*.daumcdn.net`, `*.kakao.com`)·구글 지도만.

### 휴대폰 화면 (`css/style.css` 맨 끝 `@media (max-width: 480px)`)
- 입력칸 16px(iOS 확대 방지), 보이는 칩·단추는 작게(필터 36px, 추천 기준 32px, 카드 단추 40px)·누르는 곳은 투명 `::after`로 44px.
- '다시 추천받기' 아래 줄에 메뉴·가게 검색 칸(44px).

## 테스트 구조

- `tests/e2e/fixtures.js`: 사이트 파일을 `https://app.test`로 내보내고, Supabase(로그인·표를 localStorage에 흉내)·구글·카카오를 가짜로. 그 밖의 바깥 요청은 막음. `Math.random = () => 0`으로 결과 고정. 화면 오류·CSP 위반이 있으면 실패.
  - 가짜 가게(`PLACES`): 가까운(구글 없음)·닫힌(4.9, 영업 종료)·폐업·조금(5.0, 리뷰 12)·둘째·셋째·인기(4.7, 리뷰 1,500).
  - 위치 권한을 줘서 추천을 누르면 바로 현재 위치로 찾음. `googleKey: false` 옵션이면 키 없는 상태.
- `tests/e2e/*.spec.js`: 추천(평점·거리·다른 가게·영업 상태·위치 칸), 회원(가입·즐겨찾기·최근 본 가게·탈퇴·관리자 안내), 휴대폰(누르는 높이 43px 이상, 입력칸 16px).
- `tests/db/run.sh`: 빈 DB에 `supabase-stub.sql`(역할·auth.users·auth.uid()·PostGIS) → 모든 마이그레이션 → `*.test.sql`. 테스트는 `begin … rollback`, 실패는 `raise exception 'FAIL: …'`.
- 테스트가 정말 잡는지 숫자를 일부러 바꿔 실패하는 것도 확인함(오메추 평점 기준, 문 닫은 가게 거르기, 도배 제한, 최근 30곳).

## 남은 일 / 생각해 볼 것

- 구글 요금: 평점·영업시간 필드가 든 Text Search는 비싼 등급. 사용량 보고 `RATED_CANDIDATES`(10)를 줄일지.
- 도배 제한은 전체 한도라, 누가 한도를 다 쓰면 그 한 시간 동안 다른 사람도 못 넣음. 문제가 되면 IP별 한도(요청 헤더) 검토.
- 공무원 맛집 화면에도 즐겨찾기 별을 붙일지.
