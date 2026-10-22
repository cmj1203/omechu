-- 지방에서 김치찌개·된장찌개가 곰탕·국밥집으로, 이자카야·포장마차가 단란주점·라이브카페로 나오던 것을 고쳐요.
-- 찌개는 동네 백반집에서 흔히 팔아서, 이름으로 맞는 가게가 없을 때 백반/한정식 업종 가게로 넘어가요.
update public.menus
set broad_categories = broad_categories || array['한식/백반/한정식']
where name in ('김치찌개', '된장찌개')
  and not ('한식/백반/한정식' = any(broad_categories));

-- '요리 주점' 업종에는 단란주점·라이브카페·노래주점도 있어서, 이런 이름은 업종으로 잡지 않아요.
update public.menus
set exclude_terms = exclude_terms || array['단란', '라이브', '7080', '8090', '노래', '가요', '클럽', '나이트', '홀덤']
where name in ('이자카야', '포장마차')
  and not ('단란' = any(exclude_terms));

-- 이자카야는 '요리 주점' 업종의 식당·뷔페도 빼요.
update public.menus
set exclude_terms = exclude_terms || array['식당', '뷔페']
where name = '이자카야'
  and not ('식당' = any(exclude_terms));
