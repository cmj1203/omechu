-- 메뉴를 주력으로 파는 가게를 먼저 고르려고, 검색어 중 '넓은 말'을 따로 적어 둬요.
-- 넓은 말(예: 김치찌개의 '찌개', 떡볶이의 '분식')만 이름에 든 가게는 그 메뉴가 주력이 아닐 수 있어서,
-- 주력 검색어가 이름에 든 가게가 근처에 없을 때만 안내와 함께 골라요.
alter table public.menus add column broad_terms text[] not null default '{}';

update public.menus set broad_terms = array['찌개'] where name = '김치찌개';
update public.menus set broad_terms = array['된장', '찌개'] where name = '된장찌개';
update public.menus set broad_terms = array['분식'] where name = '떡볶이';
update public.menus set broad_terms = array['국수'] where name = '잔치국수';
update public.menus set broad_terms = array['갈비'] where name = '돼지갈비';
update public.menus set broad_terms = array['고깃집'] where name = '삼겹살';
update public.menus set broad_terms = array['이탈리', '파스타'] where name = '리조또';
update public.menus set broad_terms = array['베트남'] where name in ('쌀국수', '분짜', '반미');
update public.menus set broad_terms = array['태국', 'thai', '방콕', 'bangkok'] where name in ('팟타이', '똠얌꿍');
update public.menus set broad_terms = array['인도'] where name = '커리';
update public.menus set broad_terms = array['베이커리', '제과'] where name = '케이크';
update public.menus set broad_terms = array['호프'] where name = '노가리';
update public.menus set broad_terms = array['반점', '중화'] where name = '볶음밥';

notify pgrst, 'reload schema';
