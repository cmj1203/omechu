-- 메뉴 추천 식당에 '공무원 단골' 배지를 달고, 공무원 맛집 근처 찾기에 1인 가격 상한을 더해요.
-- 돌려주는 칸이 바뀌어서 create or replace 대신 지우고 다시 만들어요.
drop function if exists public.nearby_places(double precision, double precision, integer, text[], text[], text[], text[], text);

create function public.nearby_places(
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
  matched boolean,
  official_visits integer
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
      p.osm_id, p.name, p.amenity, p.shop, p.cuisine, p.phone, p.address, p.lat, p.lng, p.location,
      extensions.st_distance(p.location, origin.point) as meters,
      coalesce(p.name ~* pattern.re, false) as name_hit
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
         round(k.meters)::integer, k.name_hit, o.visits
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

drop function if exists public.official_picks_near(double precision, double precision, integer);

create function public.official_picks_near(
  p_lat double precision,
  p_lng double precision,
  p_radius integer,
  p_max_price integer default null
)
returns table (
  name text,
  address text,
  category text,
  lat double precision,
  lng double precision,
  visits integer,
  departments integer,
  avg_per_person integer,
  lunch_visits integer,
  dinner_visits integer,
  last_visit date,
  distance integer
)
language sql
stable
set search_path = ''
as $$
  with origin as (
    select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography as point
  )
  select o.name, o.address, o.category, o.lat, o.lng, o.visits, o.departments, o.avg_per_person,
         o.lunch_visits, o.dinner_visits, o.last_visit,
         round(extensions.st_distance(o.location, origin.point))::integer
  from public.official_picks as o, origin
  where extensions.st_dwithin(o.location, origin.point, least(greatest(p_radius, 100), 5000))
    and (p_max_price is null or o.avg_per_person <= p_max_price)
  order by extensions.st_distance(o.location, origin.point)
  limit 30;
$$;

notify pgrst, 'reload schema';
