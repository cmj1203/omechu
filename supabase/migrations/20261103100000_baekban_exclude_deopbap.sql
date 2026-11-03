-- 백반의 '밥집' 검색어가 '덮밥집(zip)' 같은 덮밥 가게도 잡아서 빼요(사용자 11-03: 백반 메뉴 검색에 엉뚱한 가게).
update public.menus
set exclude_terms = array_append(exclude_terms, '덮밥집')
where name = '백반' and not ('덮밥집' = any(exclude_terms));
