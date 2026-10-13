-- '공무원 맛집' 탭: 서울시 본청 업무추진비(시장단·4급 부서장 이상) 집행내역에서 식사 자리를 가게별로 모은 표예요.
-- scripts/import-official-picks.sh 가 매달 새로 채우고, 화면은 읽기만 해요.
create table public.official_picks (
  place_key text primary key,
  name text not null,
  address text,
  category text,
  lat double precision not null,
  lng double precision not null,
  location extensions.geography(point, 4326)
    generated always as (extensions.st_setsrid(extensions.st_makepoint(lng, lat), 4326)::extensions.geography) stored,
  visits integer not null,
  departments integer not null,
  avg_per_person integer,
  lunch_visits integer not null default 0,
  dinner_visits integer not null default 0,
  last_visit date not null,
  imported_at timestamptz not null default now()
);

create index official_picks_location_idx on public.official_picks using gist (location);
create index official_picks_visits_idx on public.official_picks (visits desc);

alter table public.official_picks enable row level security;

grant select on public.official_picks to anon, authenticated;

create policy "공무원 맛집은 누구나 볼 수 있음" on public.official_picks
  for select to anon, authenticated
  using (true);

-- 위치 근처의 공무원 맛집을 가까운 순으로 (반경은 100m~5km)
create function public.official_picks_near(
  p_lat double precision,
  p_lng double precision,
  p_radius integer
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
  order by extensions.st_distance(o.location, origin.point)
  limit 30;
$$;

notify pgrst, 'reload schema';
