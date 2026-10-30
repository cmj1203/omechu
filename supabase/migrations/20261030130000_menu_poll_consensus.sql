-- '같이 정하기'를 한 표 투표에서 '먹을 수 있는 메뉴 모으기'로 바꿔요(사용자 10-30).
-- 각자 먹을 수 있는 후보를 모두 고르고(하나도 없으면 '다 못 먹어요'), 마감 전에는 답을 고칠 수 있어요.
-- 응답한 사람 모두가 고른 후보만 '모두 가능'이고, 만든 사람(방장)만 그중 하나로 확정해요. 무응답은 동의로 세지 않아요.
-- 방장 확인 키(host_token)가 새지 않게 표는 직접 읽거나 쓰지 못하게 하고, 아래 함수(rpc)로만 다뤄요.

-- 예전 한 표 투표는 버려요(만든 지 24시간이면 마감되는 임시 데이터예요).
drop trigger if exists menu_poll_votes_limit on public.menu_poll_votes;
drop function if exists public.limit_menu_poll_votes();
drop function if exists public.menu_poll_results(uuid);
drop table if exists public.menu_poll_votes;
delete from public.menu_polls;

alter table public.menu_polls
  add column area_label text not null check (char_length(btrim(area_label)) between 1 and 60),
  add column area_lat double precision not null check (area_lat between -90 and 90),
  add column area_lng double precision not null check (area_lng between -180 and 180),
  add column host_token uuid not null default gen_random_uuid(),
  add column confirmed_index integer check (confirmed_index >= 0),
  add column confirmed_at timestamptz;

create table public.menu_poll_responses (
  poll_id uuid not null references public.menu_polls (id) on delete cascade,
  -- 브라우저가 localStorage 에 만들어 두는 무작위 글자열. 같은 브라우저는 한 투표에 답 하나(고칠 수 있음)예요.
  voter text not null check (char_length(voter) between 8 and 64),
  -- 먹을 수 있는 후보 번호들. 빈 배열은 '다 못 먹어요'예요.
  accepted integer[] not null,
  updated_at timestamptz not null default now(),
  primary key (poll_id, voter)
);

alter table public.menu_poll_responses enable row level security;

revoke all on table public.menu_polls from anon, authenticated;
revoke all on table public.menu_poll_responses from anon, authenticated;

-- 만들기: 후보 2~3개와 모일 곳. 번호와 방장 확인 키를 돌려줘요(키는 만든 브라우저만 알아요).
create function public.create_menu_poll(p_options text[], p_area_label text, p_area_lat double precision, p_area_lng double precision)
returns table (id uuid, host_token uuid)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if cardinality(p_options) > 3 then
    raise exception '후보는 3개까지예요.' using errcode = '22023';
  end if;
  return query
    insert into public.menu_polls as poll (options, area_label, area_lat, area_lng)
    values (p_options, btrim(p_area_label), p_area_lat, p_area_lng)
    returning poll.id, poll.host_token;
end;
$$;

-- 보기: 투표 하나의 지금 상태. 다른 사람의 답은 후보별 수와 '모두 가능' 후보로만 보여 줘요.
-- 결과(수·공통 후보)는 자기 답을 낸 사람과 방장에게만 줘요. 남의 답을 보고 따라 고르지 않게 해요.
create function public.menu_poll_state(p_poll uuid, p_voter text, p_host_token uuid default null)
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

-- 답하기·고치기: 확정 전·마감 전에만. 번호는 후보 안에서만, 같은 번호는 한 번만 세요. 투표 하나에 200명까지.
create function public.submit_menu_poll_response(p_poll uuid, p_voter text, p_accepted integer[])
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  poll public.menu_polls;
  cleaned integer[];
begin
  select * into poll from public.menu_polls where id = p_poll for update;
  if not found then
    raise exception '투표를 찾을 수 없어요.' using errcode = 'P0002';
  end if;
  if poll.confirmed_index is not null then
    raise exception '이미 메뉴를 정했어요.' using errcode = 'P0001';
  end if;
  if poll.expires_at <= now() then
    raise exception '이 투표는 마감됐어요.' using errcode = 'P0001';
  end if;
  if p_accepted is null or exists (select 1 from unnest(p_accepted) as n where n is null or n < 0 or n >= cardinality(poll.options)) then
    raise exception '없는 후보예요.' using errcode = '22023';
  end if;
  select coalesce(array_agg(distinct n order by n), '{}') into cleaned from unnest(p_accepted) as n;
  if not exists (select 1 from public.menu_poll_responses where poll_id = p_poll and voter = p_voter)
     and (select count(*) from public.menu_poll_responses where poll_id = p_poll) >= 200 then
    raise exception '이 투표는 답이 다 찼어요.' using errcode = 'P0001';
  end if;
  insert into public.menu_poll_responses (poll_id, voter, accepted)
  values (p_poll, p_voter, cleaned)
  on conflict (poll_id, voter) do update set accepted = excluded.accepted, updated_at = now();
end;
$$;

-- 확정: 방장만, 응답한 사람 모두가 고른 후보로만. 한 번 정하면 바꾸지 않아요.
create function public.confirm_menu_poll(p_poll uuid, p_host_token uuid, p_index integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  poll public.menu_polls;
begin
  select * into poll from public.menu_polls where id = p_poll for update;
  if not found or poll.host_token <> p_host_token then
    raise exception '만든 사람만 정할 수 있어요.' using errcode = '42501';
  end if;
  if poll.confirmed_index is not null then
    raise exception '이미 메뉴를 정했어요.' using errcode = 'P0001';
  end if;
  if p_index is null or p_index < 0 or p_index >= cardinality(poll.options)
     or not exists (select 1 from public.menu_poll_responses where poll_id = p_poll)
     or exists (select 1 from public.menu_poll_responses where poll_id = p_poll and not (p_index = any (accepted))) then
    raise exception '모두 먹을 수 있는 후보가 아니에요.' using errcode = 'P0001';
  end if;
  update public.menu_polls set confirmed_index = p_index, confirmed_at = now() where id = p_poll;
end;
$$;

revoke all on function public.create_menu_poll(text[], text, double precision, double precision) from public;
revoke all on function public.menu_poll_state(uuid, text, uuid) from public;
revoke all on function public.submit_menu_poll_response(uuid, text, integer[]) from public;
revoke all on function public.confirm_menu_poll(uuid, uuid, integer) from public;
grant execute on function public.create_menu_poll(text[], text, double precision, double precision) to anon, authenticated;
grant execute on function public.menu_poll_state(uuid, text, uuid) to anon, authenticated;
grant execute on function public.submit_menu_poll_response(uuid, text, integer[]) to anon, authenticated;
grant execute on function public.confirm_menu_poll(uuid, uuid, integer) to anon, authenticated;

notify pgrst, 'reload schema';
