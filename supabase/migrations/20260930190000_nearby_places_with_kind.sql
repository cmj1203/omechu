drop function public.nearby_places(double precision, double precision, integer, text[], text[], text[], text[], text);

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
  matched boolean
)
language sql
stable
set search_path = ''
as $$
  with origin as (
    select extensions.st_setsrid(extensions.st_makepoint(p_lng, p_lat), 4326)::extensions.geography as point
  ),
  nearby as (
    select
      p.name, p.amenity, p.shop, p.cuisine, p.phone, p.address, p.lat, p.lng,
      extensions.st_distance(p.location, origin.point) as meters,
      exists (select 1 from unnest(p_terms) as term where p.name ilike '%' || term || '%') as name_hit
    from public.places as p, origin
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
