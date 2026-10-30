-- 같이 정하기: 먹을 수 있는 메뉴 모으기(20261030130000_menu_poll_consensus.sql). 끝에 되돌려요.
begin;
set local role anon;

-- 표는 직접 읽거나 쓸 수 없어요(방장 확인 키가 새지 않게)
do $$
begin
  perform 1 from public.menu_polls;
  raise exception 'FAIL: 익명이 투표 표를 직접 읽었어요';
exception when insufficient_privilege then null;
end $$;
do $$
begin
  perform 1 from public.menu_poll_responses;
  raise exception 'FAIL: 익명이 답 표를 직접 읽었어요';
exception when insufficient_privilege then null;
end $$;

do $$
declare
  poll uuid;
  host uuid;
  state jsonb;
begin
  -- 후보는 3개까지
  begin
    perform public.create_menu_poll(array['가', '나', '다', '라'], '시청역', 37.5, 127.0);
    raise exception 'FAIL: 후보 4개로 만들어졌어요';
  exception when sqlstate '22023' then null;
  end;

  select id, host_token into poll, host from public.create_menu_poll(array['김치찌개', '비빔밥', '회'], '시청역', 37.5657, 126.9769);

  -- 답하기 전에는 결과를 안 보여 줘요(방장은 봐요)
  state := public.menu_poll_state(poll, 'friend-aaaa');
  if state->'counts' <> 'null'::jsonb or state->'common' <> 'null'::jsonb or (state->>'is_host')::boolean then
    raise exception 'FAIL: 답하기 전에 결과가 보여요: %', state;
  end if;
  if not (public.menu_poll_state(poll, 'host-aaaa', host)->>'is_host')::boolean then
    raise exception 'FAIL: 방장 키로 방장이 아니라고 해요';
  end if;
  if public.menu_poll_state(poll, 'host-aaaa', host)->'common' <> '[]'::jsonb then
    raise exception 'FAIL: 아무도 답하지 않았는데 모두 가능한 후보가 있어요';
  end if;

  -- 없는 후보는 거절, 같은 번호는 한 번만
  begin
    perform public.submit_menu_poll_response(poll, 'friend-aaaa', array[3]);
    raise exception 'FAIL: 없는 후보로 답했어요';
  exception when sqlstate '22023' then null;
  end;
  perform public.submit_menu_poll_response(poll, 'friend-aaaa', array[1, 0, 0]);
  perform public.submit_menu_poll_response(poll, 'friend-bbbb', array[0, 2]);

  state := public.menu_poll_state(poll, 'friend-aaaa');
  if state->'mine' <> '[0, 1]'::jsonb or state->'counts' <> '[2, 1, 1]'::jsonb
     or state->'common' <> '[0]'::jsonb or (state->>'responders')::integer <> 2 then
    raise exception 'FAIL: 결과가 달라요: %', state;
  end if;

  -- 모두 가능하지 않은 후보, 방장 아닌 사람은 정할 수 없어요
  begin
    perform public.confirm_menu_poll(poll, host, 1);
    raise exception 'FAIL: 한 명만 고른 후보로 정해졌어요';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.confirm_menu_poll(poll, gen_random_uuid(), 0);
    raise exception 'FAIL: 방장 아닌 사람이 정했어요';
  exception when insufficient_privilege then null;
  end;

  -- '다 못 먹어요'(빈 답)가 오면 모두 가능한 후보가 없어져요. 고치면 다시 생겨요.
  perform public.submit_menu_poll_response(poll, 'friend-cccc', '{}');
  if public.menu_poll_state(poll, 'friend-cccc')->'common' <> '[]'::jsonb then
    raise exception 'FAIL: 다 못 먹는 사람이 있는데 모두 가능한 후보가 있어요';
  end if;
  perform public.submit_menu_poll_response(poll, 'friend-cccc', array[0]);

  perform public.confirm_menu_poll(poll, host, 0);
  if (public.menu_poll_state(poll, 'friend-aaaa')->>'confirmed_index')::integer <> 0 then
    raise exception 'FAIL: 확정이 저장되지 않았어요';
  end if;

  -- 정한 뒤에는 답도, 다시 정하기도 안 돼요
  begin
    perform public.submit_menu_poll_response(poll, 'friend-dddd', array[0]);
    raise exception 'FAIL: 정한 뒤에 답이 들어갔어요';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  begin
    perform public.confirm_menu_poll(poll, host, 0);
    raise exception 'FAIL: 두 번 정해졌어요';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  if public.menu_poll_state(gen_random_uuid(), 'friend-aaaa') is not null then
    raise exception 'FAIL: 없는 투표가 보여요';
  end if;
end $$;

rollback;
