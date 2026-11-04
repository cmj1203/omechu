-- 같이 정하기 후보마다 식당을 붙일 수 있게 해요. 식당은 선택이라 넣어도 되고 안 넣어도 돼요(사용자 11-04).
-- `restaurants` 는 `options` 와 길이가 같은 배열이고, 식당 없는 후보는 null 이에요. 옛 투표는 빈 배열이라 식당 없이 그대로 보여요.
-- 식당 하나는 { key, name, address, phone, lat, lng } 만 저장해요. 다른 칸은 버리고, 어긋나면 만들기를 거절해요.
-- 인자가 늘어난 새 함수로 바꾸려고 옛 4인자 create_menu_poll 은 지우고, 권한(grant)은 새 시그니처로 다시 줘요.

alter table public.menu_polls
  add column restaurants jsonb not null default '[]'::jsonb;

drop function if exists public.create_menu_poll(text[], text, double precision, double precision);

-- 만들기: 후보 2~3개, 모일 곳, (선택) 후보별 식당. 번호와 방장 확인 키를 돌려줘요(키는 만든 브라우저만 알아요).
create function public.create_menu_poll(
  p_options text[],
  p_area_label text,
  p_area_lat double precision,
  p_area_lng double precision,
  p_restaurants jsonb default '[]'::jsonb
)
returns table (id uuid, host_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
declare
  src jsonb := coalesce(p_restaurants, '[]'::jsonb);
  cleaned jsonb := '[]'::jsonb;
  el jsonb;
  n integer;
  i integer;
begin
  if cardinality(p_options) > 3 then
    raise exception '후보는 3개까지예요.' using errcode = '22023';
  end if;
  if jsonb_typeof(src) <> 'array' or jsonb_array_length(src) > cardinality(p_options) then
    raise exception '식당 정보가 올바르지 않아요.' using errcode = '22023';
  end if;
  n := jsonb_array_length(src);
  for i in 0 .. n - 1 loop
    el := src -> i;
    if jsonb_typeof(el) = 'null' then
      cleaned := cleaned || jsonb_build_array(null);
      continue;
    end if;
    if jsonb_typeof(el) <> 'object'
       or jsonb_typeof(el -> 'name') is distinct from 'string'
       or char_length(el ->> 'name') not between 1 and 80
       or jsonb_typeof(el -> 'key') is distinct from 'string'
       or char_length(el ->> 'key') > 80
       or jsonb_typeof(el -> 'lat') is distinct from 'number'
       or (el ->> 'lat')::double precision not between -90 and 90
       or jsonb_typeof(el -> 'lng') is distinct from 'number'
       or (el ->> 'lng')::double precision not between -180 and 180
       or jsonb_typeof(coalesce(el -> 'address', 'null'::jsonb)) not in ('null', 'string')
       or char_length(coalesce(el ->> 'address', '')) > 200
       or jsonb_typeof(coalesce(el -> 'phone', 'null'::jsonb)) not in ('null', 'string')
       or char_length(coalesce(el ->> 'phone', '')) > 200 then
      raise exception '식당 정보가 올바르지 않아요.' using errcode = '22023';
    end if;
    cleaned := cleaned || jsonb_build_array(jsonb_build_object(
      'key', el -> 'key',
      'name', el -> 'name',
      'address', coalesce(el -> 'address', 'null'::jsonb),
      'phone', coalesce(el -> 'phone', 'null'::jsonb),
      'lat', el -> 'lat',
      'lng', el -> 'lng'
    ));
  end loop;
  -- 짧은 배열은 후보 수만큼 null 로 채워요.
  for i in n .. cardinality(p_options) - 1 loop
    cleaned := cleaned || jsonb_build_array(null);
  end loop;
  return query
    insert into public.menu_polls as poll (options, area_label, area_lat, area_lng, restaurants)
    values (p_options, btrim(p_area_label), p_area_lat, p_area_lng, cleaned)
    returning poll.id, poll.host_token;
end;
$$;

-- 보기: 결과에 후보별 식당(restaurants)을 더해요. 나머지는 그대로예요.
create or replace function public.menu_poll_state(p_poll uuid, p_voter text, p_host_token uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  poll public.menu_polls;
  mine integer[];
  responders integer;
  counts integer[];
  common integer[];
  is_host boolean;
begin
  select * into poll from public.menu_polls where menu_polls.id = p_poll;
  if not found then
    return null;
  end if;
  is_host := p_host_token is not null and p_host_token = poll.host_token;
  select accepted into mine from public.menu_poll_responses where poll_id = p_poll and voter = p_voter;
  select count(*) into responders from public.menu_poll_responses where poll_id = p_poll;
  select
    array_agg((select count(*) from public.menu_poll_responses as r where r.poll_id = p_poll and i - 1 = any (r.accepted))::integer order by i),
    coalesce(array_agg(i - 1 order by i) filter (
      where responders > 0
        and not exists (select 1 from public.menu_poll_responses as r where r.poll_id = p_poll and not (i - 1 = any (r.accepted)))
    ), '{}')
  into counts, common
  from generate_subscripts(poll.options, 1) as i;
  return jsonb_build_object(
    'id', poll.id,
    'options', to_jsonb(poll.options),
    'restaurants', poll.restaurants,
    'area', jsonb_build_object('label', poll.area_label, 'lat', poll.area_lat, 'lng', poll.area_lng),
    'expires_at', poll.expires_at,
    'confirmed_index', poll.confirmed_index,
    'is_host', is_host,
    'mine', to_jsonb(mine),
    'responders', case when mine is not null or is_host then responders end,
    'counts', case when mine is not null or is_host then to_jsonb(counts) end,
    'common', case when mine is not null or is_host then to_jsonb(common) end
  );
end;
$$;

revoke all on function public.create_menu_poll(text[], text, double precision, double precision, jsonb) from public;
grant execute on function public.create_menu_poll(text[], text, double precision, double precision, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
