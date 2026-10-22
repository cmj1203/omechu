-- 백반/한정식 업종에 카페·갤러리도 섞여 있어서 김치찌개·된장찌개는 이런 이름을 업종으로 잡지 않아요.
update public.menus
set exclude_terms = exclude_terms || array['카페', '커피', '로스터리', '갤러리']
where name in ('김치찌개', '된장찌개')
  and not ('카페' = any(exclude_terms));

-- '탄금Live' 처럼 영어로 쓴 라이브카페도 빼요.
update public.menus
set exclude_terms = exclude_terms || array['live']
where name in ('이자카야', '포장마차')
  and not ('live' = any(exclude_terms));
