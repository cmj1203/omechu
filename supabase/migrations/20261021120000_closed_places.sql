-- 문 닫은 가게를 식당 검색에서 빼요.
-- closed_places: 인허가 자료에서 폐업으로 확인된 가게. scripts/closed_places.py 가 매달 다시 채워요(서버 키로만 씀).
-- closure_reports: 사용자가 '문 닫았어요'로 알린 가게. 누구나 넣고, 관리자가 보고 숨긴 뒤 지워요.
create table public.closed_places (
  osm_id text primary key,
  name text not null,
  closed_on date,
  source text not null,
  checked_at timestamptz not null default now()
);

alter table public.closed_places enable row level security;

grant select on public.closed_places to anon, authenticated;

create policy "폐업 가게 목록은 누구나 볼 수 있음" on public.closed_places
  for select to anon, authenticated
  using (true);

create table public.closure_reports (
  id bigint generated always as identity primary key,
  name text not null check (char_length(name) between 1 and 200),
  address text check (char_length(address) <= 300),
  lat double precision not null check (lat between 33 and 39),
  lng double precision not null check (lng between 124 and 132),
  reported_at timestamptz not null default now()
);

alter table public.closure_reports enable row level security;

grant insert on public.closure_reports to anon, authenticated;
grant select, delete on public.closure_reports to authenticated;

create policy "누구나 문 닫은 가게 알리기" on public.closure_reports
  for insert to anon, authenticated
  with check (true);

create policy "관리자만 알림 보기" on public.closure_reports
  for select to authenticated
  using ((select public.is_admin()));

create policy "관리자만 알림 지우기" on public.closure_reports
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
      coalesce(p.name ~* pattern.re, false) as term_hit,
      coalesce(p.name ~* pattern.re, false) or coalesce(p.category = any(p_categories), false) as name_hit
    from public.places as p, origin, pattern
    where extensions.st_dwithin(p.location, origin.point, least(greatest(p_radius, 100), 5000))
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
