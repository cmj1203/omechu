-- 공무원 맛집에 은평구·서대문구·행정안전부 기록을 더하면서, 가게마다 어느 기관 기록인지 적어요(예: '서울시 본청, 은평구').
alter table public.official_picks add column agencies text not null default '서울시 본청';

drop function if exists public.official_picks_near(double precision, double precision, integer, integer);

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
  agencies text,
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
         o.lunch_visits, o.dinner_visits, o.last_visit, o.agencies,
         round(extensions.st_distance(o.location, origin.point))::integer
  from public.official_picks as o, origin
  where extensions.st_dwithin(o.location, origin.point, least(greatest(p_radius, 100), 5000))
    and (p_max_price is null or o.avg_per_person <= p_max_price)
  order by extensions.st_distance(o.location, origin.point)
  limit 30;
$$;

notify pgrst, 'reload schema';
