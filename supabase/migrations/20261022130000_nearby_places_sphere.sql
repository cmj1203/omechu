-- 가게가 많은 곳(서울·부평 5km)에서 검색이 공개 키 시간 제한(3초)에 걸리던 것을 고쳐요.
-- 거리를 지구 타원체 대신 구면으로 계산해요(차이 0.3% 안쪽). 노원 2km 0.39→0.17초, 부평 5km 1.9→0.35초.
create or replace function public.nearby_places(
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
      extensions.st_distance(p.location, origin.point, false) as meters,
      coalesce(p.name ~* pattern.re, false) as term_hit,
      coalesce(p.name ~* pattern.re, false) or coalesce(p.category = any(p_categories), false) as name_hit
    from public.places as p, origin, pattern
    where extensions.st_dwithin(p.location, origin.point, least(greatest(p_radius, 100), 5000), false)
      and not exists (select 1 from public.hidden_places as h where h.osm_id = p.osm_id)
      and not exists (select 1 from public.closed_places as c where c.osm_id = p.osm_id)
  ),
  picked as (
    select *
    from nearby
    where (name_hit and (amenity = any(p_amenities) or shop = any(p_shops)))
       or (not name_hit and amenity = any(p_similar_amenities)
           and (p_similar_cuisine is null or cuisine ~* p_similar_cuisine))
    order by name_hit desc, term_hit desc, meters
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
       or (extensions.st_dwithin(op.location, k.location, 40, false)
           and char_length(regexp_replace(lower(k.name), '\s', '', 'g')) >= 2
           and (strpos(regexp_replace(lower(op.name), '\s', '', 'g'), regexp_replace(lower(k.name), '\s', '', 'g')) > 0
             or strpos(regexp_replace(lower(k.name), '\s', '', 'g'), regexp_replace(lower(op.name), '\s', '', 'g')) > 0))
    order by op.visits desc
    limit 1
  ) as o on true
  order by k.name_hit desc, k.meters;
$$;

notify pgrst, 'reload schema';
