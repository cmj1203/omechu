-- 식당 검색을 빠르게: 가게 이름을 검색어 하나하나와 따로 비교(ilike)하던 것을, 검색어를 모두 합친 정규식 한 번으로 비교해요.
-- 메뉴가 149개로 늘자 '전체' 필터(검색어 368개)에서 3초 제한에 걸려 식당을 못 찾던 문제를 고쳐요 (결과는 같고 0.1~0.8초).
create or replace function public.nearby_places(
  p_lat double precision,
  p_lng double precision,
  p_radius integer,
  p_terms text[],
  p_amenities text[],
  p_shops text[],
  p_similar_amenities text[],
  p_similar_cuisine text
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
  matched boolean
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
      p.name, p.amenity, p.shop, p.cuisine, p.phone, p.address, p.lat, p.lng,
      extensions.st_distance(p.location, origin.point) as meters,
      coalesce(p.name ~* pattern.re, false) as name_hit
    from public.places as p, origin, pattern
    where extensions.st_dwithin(p.location, origin.point, least(greatest(p_radius, 100), 5000))
  )
  select name, amenity, shop, cuisine, phone, address, lat, lng, round(meters)::integer, name_hit
  from nearby
  where (name_hit and (amenity = any(p_amenities) or shop = any(p_shops)))
     or (not name_hit and amenity = any(p_similar_amenities)
         and (p_similar_cuisine is null or cuisine ~* p_similar_cuisine))
  order by name_hit desc, meters
  limit 80;
$$;

drop function if exists public.nearby_places_regex_test(double precision, double precision, integer, text[], text[], text[], text[], text);

notify pgrst, 'reload schema';
