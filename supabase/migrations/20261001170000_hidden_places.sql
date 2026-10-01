-- 관리자가 폐업했거나 엉뚱한 가게를 숨길 수 있게 해요. 숨긴 가게는 주변 식당 검색(nearby_places)에서 빠져요.
-- 가게 정보(places)는 매달 새로 가져오며 지웠다 다시 넣으니까, 외래 키 없이 OpenStreetMap 번호(osm_id)로 기억해요.
create table public.hidden_places (
  osm_id text primary key,
  name text not null,
  address text,
  hidden_at timestamptz not null default now()
);

alter table public.hidden_places enable row level security;

grant select on public.hidden_places to anon, authenticated;
grant insert, delete on public.hidden_places to authenticated;

create policy "숨긴 가게 목록은 누구나 볼 수 있음" on public.hidden_places
  for select to anon, authenticated
  using (true);

create policy "관리자만 가게 숨기기" on public.hidden_places
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "관리자만 다시 보이기" on public.hidden_places
  for delete to authenticated
  using ((select public.is_admin()));

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
      and not exists (select 1 from public.hidden_places as h where h.osm_id = p.osm_id)
  )
  select name, amenity, shop, cuisine, phone, address, lat, lng, round(meters)::integer, name_hit
  from nearby
  where (name_hit and (amenity = any(p_amenities) or shop = any(p_shops)))
     or (not name_hit and amenity = any(p_similar_amenities)
         and (p_similar_cuisine is null or cuisine ~* p_similar_cuisine))
  order by name_hit desc, meters
  limit 80;
$$;

notify pgrst, 'reload schema';
