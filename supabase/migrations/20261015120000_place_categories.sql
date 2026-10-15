-- 상가정보 업종(중분류/소분류)으로도 메뉴 가게를 찾아요. 이름에 메뉴 글자가 없는 가게('BHC', '행복한집' 등)가
-- 빠져서 인천·지방에서 가게가 적게 나왔어요. 업종이 곧 메뉴면(치킨, 중국집) 주력 가게로, 넓은 업종이면(국/탕/찌개류, 분식) 넓은 말 가게로 봐요.
alter table public.places add column category text;

alter table public.menus
  add column categories text[] not null default '{}',
  add column broad_categories text[] not null default '{}';

update public.menus set categories = array['기타 간이/치킨'] where name in ('치킨', '통닭');
update public.menus set categories = array['중식/중국집'] where name in ('짜장면', '짬뽕', '탕수육');
update public.menus set broad_categories = array['중식/중국집'] where name = '볶음밥';
update public.menus set categories = array['기타 간이/피자'] where name = '피자';
update public.menus set categories = array['기타 간이/버거'] where name = '햄버거';
update public.menus set categories = array['한식/족발/보쌈'] where name in ('족발', '보쌈');
update public.menus set categories = array['한식/횟집', '일식/일식 회/초밥'] where name = '생선회';
update public.menus set broad_categories = array['한식/횟집'] where name = '물회';
update public.menus set categories = array['일식/일식 회/초밥'] where name = '초밥';
update public.menus set categories = array['중식/마라탕/훠궈'] where name in ('마라탕', '훠궈', '마라샹궈');
update public.menus set categories = array['동남아시아/베트남식 전문'] where name = '쌀국수';
update public.menus set broad_categories = array['동남아시아/베트남식 전문'] where name in ('분짜', '반미');
update public.menus set categories = array['한식/곱창 전골/구이'] where name = '곱창';
update public.menus set categories = array['한식/돼지고기 구이/찜'] where name = '삼겹살';
update public.menus set broad_categories = array['한식/돼지고기 구이/찜'] where name = '돼지갈비';
update public.menus set categories = array['한식/소고기 구이/찜'] where name = '소고기';
update public.menus set broad_categories = array['한식/닭/오리고기 구이/찜'] where name in ('오리고기', '닭갈비', '닭한마리', '찜닭');
update public.menus set categories = array['한식/냉면/밀면'] where name = '냉면';
update public.menus set broad_categories = array['한식/냉면/밀면', '한식/국수/칼국수'] where name = '막국수';
update public.menus set broad_categories = array['한식/국수/칼국수'] where name in ('칼국수', '잔치국수', '콩국수', '수제비');
update public.menus set broad_categories = array['기타 간이/김밥/만두/분식'] where name in ('김밥', '떡볶이', '라면', '만두', '쫄면', '순대', '튀김');
update public.menus set broad_categories = array['한식/국/탕/찌개류']
  where name in ('국밥', '순대국', '해장국', '설렁탕', '곰탕', '갈비탕', '김치찌개', '된장찌개', '감자탕', '순두부찌개', '부대찌개', '육개장', '추어탕', '동태찌개', '청국장', '해물탕', '삼계탕');
update public.menus set broad_categories = array['일식/일식 카레/돈가스/덮밥', '서양식/경양식'] where name = '돈카츠';
update public.menus set broad_categories = array['일식/일식 카레/돈가스/덮밥'] where name in ('커리', '규동', '규카츠', '연어덮밥', '텐동');
update public.menus set broad_categories = array['일식/일식 면 요리'] where name in ('라멘', '우동', '소바');
update public.menus set broad_categories = array['서양식/파스타/스테이크', '서양식/패밀리레스토랑'] where name in ('파스타', '스테이크', '리조또');
update public.menus set broad_categories = array['서양식/경양식'] where name in ('함박스테이크', '오므라이스');
update public.menus set broad_categories = array['기타 간이/토스트/샌드위치/샐러드'] where name in ('토스트', '샌드위치', '샐러드');
update public.menus set broad_categories = array['기타 간이/아이스크림/빙수'] where name in ('아이스크림', '빙수');
update public.menus set broad_categories = array['기타 간이/빵/도넛'] where name in ('도넛', '케이크', '소금빵', '베이글', '에그타르트');
update public.menus set categories = array['한식/전/부침개'] where name = '파전';
update public.menus set broad_categories = array['한식/전/부침개'] where name = '막걸리';
update public.menus set broad_categories = array['한식/해산물 구이/찜'] where name in ('조개구이', '생선구이', '아귀찜', '코다리찜', '갈치조림', '대게');
update public.menus set categories = array['한식/백반/한정식'] where name in ('백반', '한정식');
update public.menus set broad_categories = array['주점/요리 주점'] where name in ('포장마차', '이자카야');
update public.menus set broad_categories = array['주점/생맥주 전문'] where name in ('수제맥주', '노가리');

-- 돌려주는 칸(category)과 받는 값(p_categories)이 늘어서 지우고 다시 만들어요.
-- p_categories 는 기본값이 있어서, 이 값을 안 보내는 옛 화면도 그대로 동작해요.
drop function if exists public.nearby_places(double precision, double precision, integer, text[], text[], text[], text[], text);

create function public.nearby_places(
  p_lat double precision,
  p_lng double precision,
  p_radius integer,
  p_terms text[],
  p_amenities text[],
  p_shops text[],
  p_similar_amenities text[],
  p_similar_cuisine text,
  p_categories text[] default '{}'
)
returns table (
  name text,
  amenity text,
  shop text,
  cuisine text,
  phone text,
  address text,
  lat double precision,
  lng double precision,
  distance integer,
  matched boolean,
  official_visits integer,
  category text
)
language sql
stable
set search_path = ''
as $$
  with origin as (
    select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography as point
  ),
  pattern as (
    select string_agg(regexp_replace(term, '([.^$|?*+()\[\]{}\\])', '\\\1', 'g'), '|') as re
    from unnest(p_terms) as term
    where term <> ''
  ),
  nearby as (
    select
      p.osm_id, p.name, p.amenity, p.shop, p.cuisine, p.phone, p.address, p.lat, p.lng, p.location, p.category,
      extensions.st_distance(p.location, origin.point) as meters,
      coalesce(p.name ~* pattern.re, false) or coalesce(p.category = any(p_categories), false) as name_hit
    from public.places as p, origin, pattern
    where extensions.st_dwithin(p.location, origin.point, least(greatest(p_radius, 100), 5000))
      and not exists (select 1 from public.hidden_places as h where h.osm_id = p.osm_id)
  ),
  picked as (
    select *
    from nearby
    where (name_hit and (amenity = any(p_amenities) or shop = any(p_shops)))
       or (not name_hit and amenity = any(p_similar_amenities)
           and (p_similar_cuisine is null or cuisine ~* p_similar_cuisine))
    order by name_hit desc, meters
    limit 80
  )
  select k.name, k.amenity, k.shop, k.cuisine, k.phone, k.address, k.lat, k.lng,
         round(k.meters)::integer, k.name_hit, o.visits, k.category
  from picked as k
  -- 같은 가게 찾기: 상가정보 번호가 같거나, 40m 안에서 띄어쓰기 뺀 이름 한쪽이 다른 쪽에 들어 있으면 같은 가게로 봐요.
  left join lateral (
    select op.visits
    from public.official_picks as op
    where op.place_key = k.osm_id
       or (extensions.st_dwithin(op.location, k.location, 40)
           and char_length(regexp_replace(lower(k.name), '\s', '', 'g')) >= 2
           and (strpos(regexp_replace(lower(op.name), '\s', '', 'g'), regexp_replace(lower(k.name), '\s', '', 'g')) > 0
             or strpos(regexp_replace(lower(k.name), '\s', '', 'g'), regexp_replace(lower(op.name), '\s', '', 'g')) > 0))
    order by op.visits desc
    limit 1
  ) as o on true
  order by k.name_hit desc, k.meters;
$$;

notify pgrst, 'reload schema';
