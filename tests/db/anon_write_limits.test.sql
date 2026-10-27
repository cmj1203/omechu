-- 익명 넣기 제한(20261027120000_anon_write_limits.sql). 전부 한 트랜잭션 안에서 하고 끝에 되돌려요.
begin;
set local role anon;

do $$
declare
  i integer;
  poll uuid;
begin
  -- 같은 가게는 하루 3번까지
  for i in 1..3 loop
    insert into public.closure_reports (name, lat, lng) values ('테스트김밥', 37.5, 127.0);
  end loop;
  begin
    insert into public.closure_reports (name, lat, lng) values ('테스트김밥', 37.50001, 127.00001);
    raise exception 'FAIL: 같은 가게 4번째 알림이 들어갔어요';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  -- 다른 가게는 괜찮고, 전체는 한 시간에 300번까지
  for i in 4..300 loop
    insert into public.closure_reports (name, lat, lng) values ('가게' || i, 37.5, 127.0);
  end loop;
  begin
    insert into public.closure_reports (name, lat, lng) values ('301번째', 37.5, 127.0);
    raise exception 'FAIL: 한 시간 301번째 알림이 들어갔어요';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;

  -- 투표는 한 시간에 300개까지
  for i in 1..300 loop
    insert into public.menu_polls (options) values (array['짜장면', '짬뽕']);
  end loop;
  begin
    insert into public.menu_polls (options) values (array['짜장면', '짬뽕']);
    raise exception 'FAIL: 한 시간 301번째 투표가 만들어졌어요';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- 표는 투표 하나에 200표까지(투표 번호는 관리자 역할로 꺼내요. 익명은 rpc 없이 select 로 볼 수 있어요)
do $$
declare
  i integer;
  poll uuid;
begin
  select id into poll from public.menu_polls limit 1;
  for i in 1..200 loop
    insert into public.menu_poll_votes (poll_id, voter, option_index) values (poll, 'voter-' || lpad(i::text, 4, '0'), 0);
  end loop;
  begin
    insert into public.menu_poll_votes (poll_id, voter, option_index) values (poll, 'voter-0201', 1);
    raise exception 'FAIL: 201번째 표가 들어갔어요';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- 제한 함수는 API(rpc)로 부를 수 없어요
do $$
begin
  if has_function_privilege('anon', 'public.limit_closure_reports()', 'execute') then
    raise exception 'FAIL: 익명이 제한 함수를 부를 수 있어요';
  end if;
end $$;

rollback;
