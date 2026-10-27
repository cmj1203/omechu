# 이어받기 메모 (평점 추천)

다른 Claude 세션(터미널 등)이 이 작업을 이어받을 수 있게 적어 두는 문서예요. 작업할 때마다 고쳐요.

- 브랜치: `claude/serene-faraday-2f849z` (PR 아직 없음)
- 마지막 갱신: 2026-10-27

## 지금까지 한 것

1. **구글 평점 연동** (`js/place-rating.js`)
   - 카카오·네이버 API는 평점·리뷰 수를 주지 않고, 화면 긁기는 약관 위반이라 사용자와 상의해 구글 Places로 정함.
   - 서버 없이 브라우저에서 Maps JavaScript API의 `Place.searchByText`로 가게 이름을 찾고, 300m 안에서 이름이 서로 들어 있는 곳을 같은 가게로 봄.
   - 결과: `{ rating, reviews }`, 구글에 없거나 평점이 없으면 `null`, 못 물어봤으면(키 없음·오류·4초 초과) `undefined`. 같은 가게는 화면을 연 동안 캐시.
   - **`GOOGLE_MAPS_KEY`가 아직 비어 있음.** 사용자가 Google Cloud에서 키를 만들어 넣어야 함(README 8번). 비어 있으면 평점 기능 전체가 꺼지고 예전처럼 가까운 순.
2. **추천에 평점 반영** (`js/nearby-restaurant-search.js`)
   - `searchCandidates`가 반경(2km/5km)과 후보를 정하고(평점 안 물어봄), `choose`를 고르는 함수(`pickNearest` / 평점으로 고르는 함수)를 받아 한 번 더 돌려 추천을 고름.
3. **표시** (`js/nearby-renderer.js`, `css/style.css`)
   - 추천 상자에 평점 한 줄(`.restaurant-rating`), 다른 가까운 곳 목록에 `★ 4.6`(`.rating-tag`). 평점이 없거나 리뷰가 적으면 `-`, 못 물어봤으면 아무것도 안 붙임.
   - 바닥글에 `평점 © Google` (구글 약관상 출처 표시).
4. **검증**: 이 클라우드 환경에서는 구글·Supabase·CDN에 못 나가서, Playwright로 두 응답을 가짜로 바꿔 확인함(아래 '검증 방법').

5. **평점 우선 / 거리 우선 고르기 + 오메추 평점** (사용자 요청 2026-10-27, 끝남)
   - `index.html`의 `#nearbyOrder` 칩 → `js/nearby.js`가 `searchRestaurants(..., order)`로 넘김. 바꾸면 같은 위치에서 바로 다시 고름.
   - `omechuRating()` (`js/place-rating.js`): 리뷰 수를 반영한 평점. 화면에는 오메추 평점을, 괄호·툴팁에 구글 원래 평점과 리뷰 수.
   - `fieldset.elements`는 라디오를 RadioNodeList로 묶어 주지 않아서(첫 input만 나옴) `querySelector("input:checked")`로 읽음.

## 정한 것과 이유

- **오메추 평점** = 베이즈 평균 `(리뷰수 × 구글평점 + 100 × 4.0) / (리뷰수 + 100)`.
  리뷰가 적을수록 4.0 쪽으로 끌려가요. 리뷰 100개면 구글 평점과 4.0의 딱 중간, 1,000개면 구글 평점에 거의 가까워요.
  - 처음 요청이던 "리뷰 100개 이상일 때만 평점 적용"은 그대로 둠: 100개 미만은 `-`로 보이고 4.0으로 계산.
- **평점 우선**: 후보 중 가까운 10곳의 오메추 평점을 보고, 1등과 0.1 이내인 곳(최대 3곳) 중 하나를 무작위로. 다른 가까운 곳 목록도 오메추 평점 순.
- **거리 우선**: 예전처럼 가까운 3곳 중 무작위, 목록은 가까운 순. 평점은 표시만 함.
- 거리 우선에서도 평점은 표시하려고 구글에 물어봄(호출 수는 평점 우선과 비슷).
- 고른 순서는 이 기기에 기억(`localStorage`의 `omechu.recommendOrder`).
- 구글 키가 없으면 순서 칩을 숨김(고를 의미가 없음).
- 가게 검색·메뉴 검색 목록(최대 30곳)에는 평점을 안 붙임(구글 호출 비용).

## 검증 방법

이 환경은 외부 접속이 막혀 있어 아래처럼 가짜 응답으로 확인했어요. 터미널에서 실제 키로 확인할 수 있으면 그게 더 좋아요.

- Playwright로 `http://app.test/`를 열고 `page.route`로
  - `cdn.jsdelivr.net/.../supabase-js` → `rpc()`가 가짜 가게 줄을 돌려주는 `createClient`
  - `maps.googleapis.com` → `google.maps.importLibrary("places")`가 가짜 `Place.searchByText`를 돌려주고 `callback`을 부르는 스크립트
  - `place-rating.js`는 `GOOGLE_MAPS_KEY`를 `"TEST"`로 바꿔 내보냄
  - 한글이 깨지지 않게 `content-type`에 `charset=utf-8`을 꼭 붙일 것
- 페이지에서 `import('/js/nearby-restaurant-search.js')`로 `searchRestaurants`를 30번 돌려 고른 가게 분포를 보고, 렌더러로 그려 스크린샷.
- 화면 전체: `index.html`을 `https://app.test/`로 열고 위치 권한(geolocation)을 줘서 자동으로 찾게 함. 가짜 `rpc`는 `p_terms[0]`을 붙인 이름으로 가게를 돌려줘야 어떤 메뉴가 나와도 맞음. 가짜 `from()`은 빈 목록 → 기본 메뉴 목록(`data/menus.json`) 사용.
- 확인한 것: 평점 우선이 리뷰 많은 고평점(4.7·1,200 / 4.6·3,000)을 고르고 리뷰 120개 4.9는 뺌, 거리 우선은 가까운 3곳 중, 칩을 바꾸면 다시 고름, 새로고침해도 기억, 가게 검색에서는 칩 숨김, 키 없으면 평점 표시 없음.

## 남은 일 / 확인할 것

- 실제 구글 키로 이름·위치 맞추기가 잘 되는지(체인점 '○○점' 이름, 영어 이름 가게).
- 구글 요금: 평점 필드가 든 Text Search는 비싼 등급. 사용량 보고 `RATED_CANDIDATES`(10)를 줄일지.
- PR은 사용자가 요청할 때만.
