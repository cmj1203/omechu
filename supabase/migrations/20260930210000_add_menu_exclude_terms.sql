-- 메뉴별 식당 검색 다듬기 (전국 식당 이름 점검 결과).
-- 제외어: 가게 이름에서 이 말 속에 든 검색어는 안 쳐요 (예: 커리 메뉴의 '베이커리', 야키토리 메뉴의 '양꼬치').
alter table public.menus add column exclude_terms text[] not null default '{}';

update public.menus set exclude_terms = array['부대찌개', '동태찌개', '순두부찌개'] where name = '김치찌개';
update public.menus set exclude_terms = array['부대찌개', '동태찌개', '순두부찌개', '김치찌개', '된장족발'] where name = '된장찌개';
update public.menus set search_terms = array['설렁탕', '설농탕', 'seolleongtang'] where name = '설렁탕';
update public.menus set exclude_terms = array['국밥집', '초밥집', '쌈밥집', '김밥집', '카레밥집'] where name = '백반';
update public.menus set exclude_terms = array['피자장'] where name = '짜장면';
update public.menus set exclude_terms = array['마라도횟', '마라도회', '마라도아구', '마라도에서', '마라도해물'] where name = '마라탕';
update public.menus set exclude_terms = array['마라도횟', '마라도회', '마라도아구', '마라도에서', '마라도해물'] where name = '마라샹궈';
update public.menus set search_terms = array['딤섬', 'dimsum', 'dim sum', '팀호완', '딘타이펑'] where name = '딤섬';
update public.menus set search_terms = array['소바', '모밀'], exclude_terms = array['에스프레소'] where name = '소바';
update public.menus set search_terms = array['텐동', '덴동', '텐푸라', 'tendon'] where name = '텐동';
update public.menus set search_terms = array['피자', 'pizza', 'domino'] where name = '피자';
update public.menus set search_terms = array['버거', 'burger', '맥도날드', '롯데리아', '맘스터치', 'kfc', 'shake shack'], exclude_terms = array['밥버거'] where name = '햄버거';
update public.menus set search_terms = array['샐러', 'salad'] where name = '샐러드';
update public.menus set search_terms = array['샌드위치', 'sandwich', '서브웨이', '써브웨이', 'subway'] where name = '샌드위치';
update public.menus set search_terms = array['타코', 'taco', '멕시코', '부리또', '브리또', 'burrito'], exclude_terms = array['타코야', '타코비', '멕시코니'] where name = '타코';
update public.menus set search_terms = array['쌀국수', 'pho', '베트남', '사이공', '포메인', '포베이', '에머이'] where name = '쌀국수';
update public.menus set search_terms = array['팟타이', '태국', 'thai', '방콕', 'bangkok'] where name = '팟타이';
update public.menus set search_terms = array['커리', '카레', 'curry', '인도', '아비꼬', '코코이찌'], exclude_terms = array['베이커리', '인도시락'] where name = '커리';
update public.menus set search_terms = array['떡볶이', '떡볶기', '떡복이', '분식', 'tteokbokki', 'topokki'] where name = '떡볶이';
update public.menus set search_terms = array['타코야끼', '타코야키', '타코비'], exclude_terms = array['타코비스트로'] where name = '타코야키';
update public.menus set search_terms = array['도넛', '도너츠', '도나스', '노티드', 'donut', 'doughnut', '던킨', 'dunkin'] where name = '도넛';
update public.menus set search_terms = array['버블티', '공차', '밀크티', '팔공티'] where name = '버블티';
update public.menus set exclude_terms = array['치킨주막'] where name = '막걸리';
update public.menus set exclude_terms = array['포차돌'] where name = '포장마차';
update public.menus set search_terms = array['이자카야', 'izakaya', '선술집', '사케'] where name = '이자카야';
update public.menus set exclude_terms = array['양꼬치', '꼬꼬치킨'] where name = '야키토리';
update public.menus set search_terms = array['맥주', '비어', 'beer', 'brew', '펍', '브루어리', '탭하우스', 'taphouse', '크래프트', 'craft'], exclude_terms = array['홀덤펍'] where name = '수제맥주';
