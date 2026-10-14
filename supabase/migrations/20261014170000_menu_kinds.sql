-- 메뉴 하나가 식사·간식·술 중 여러 종류에 들 수 있게 kinds 칸을 더하고, 149개 메뉴를 다시 분류해요 (예: 떡볶이 = 식사·간식).
-- 옛 kind 칸은 지금 공개된 화면이 아직 읽어서 이번에는 남기고 빈칸을 허용해요. 새 화면이 배포되면 다음 마이그레이션에서 지워요.
alter table public.menus add column kinds text[];

update public.menus set kinds = array[kind];
update public.menus set kinds = array['간식'] where name in ('버블티', '도넛', '생과일주스', '소금빵', '아이스크림', '에그타르트', '와플', '츄러스', '케이크', '쿠키', '크레페', '팬케이크', '핫도그', '탕후루', '꽈배기', '붕어빵', '빙수', '호두과자', '호떡');
update public.menus set kinds = array['식사', '간식'] where name in ('베이글', '토스트', '떡볶이', '순대', '김밥', '라면', '만두', '쫄면', '주먹밥', '샌드위치', '햄버거', '반미', '딤섬', '케밥');
update public.menus set kinds = array['간식', '술'] where name in ('타코야키', '닭강정', '튀김');
update public.menus set kinds = array['식사', '간식', '술'] where name in ('치킨', '통닭');
update public.menus set kinds = array['술'] where name in ('수제맥주', '와인바', '위스키', '칵테일', '하이볼', '오뎅바', '이자카야', '골뱅이무침', '노가리', '닭발', '돼지껍데기', '막걸리', '오돌뼈', '포장마차', '야키토리');
update public.menus set kinds = array['식사', '술'] where name in ('양꼬치', '곱창', '생선회', '순대볶음', '육회', '조개구이', '족발', '파전', '피자', '타코', '오코노미야키', '마라샹궈', '탕수육', '훠궈', '감자탕', '닭갈비', '닭볶음탕', '닭한마리', '대게', '돼지갈비', '보쌈', '삼겹살', '소고기', '아귀찜', '쭈꾸미볶음', '해물탕', '물회', '부대찌개', '낙지볶음', '오징어볶음', '오리고기');

alter table public.menus
  alter column kinds set not null,
  add constraint menus_kinds_check check (cardinality(kinds) > 0 and kinds <@ array['식사', '간식', '술']),
  alter column kind drop not null;

notify pgrst, 'reload schema';
