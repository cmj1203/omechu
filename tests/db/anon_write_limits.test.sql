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
    perform public.create_menu_poll(array['짜장면', '짬뽕'], '시청역', 37.5, 127.0);
  end loop;
  begin
    perform public.create_menu_poll(array['짜장면', '짬뽕'], '시청역', 37.5, 127.0);
    raise exception 'FAIL: 한 시간 301번째 투표가 만들어졌어요';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- 답은 투표 하나에 200명까지. 이미 답한 사람은 그 뒤에도 고칠 수 있어요.
-- 한 시간 한도를 위에서 다 썼으니 만든 투표 하나를 관리자 역할로 꺼내 익명에게 넘겨요(익명은 표를 직접 못 읽어요).
reset role;
create temp table test_poll on commit drop as select id from public.menu_polls limit 1;
grant select on test_poll to anon;
set local role anon;
do $$
declare
  i integer;
  poll uuid;
begin
  select id into poll from test_poll;
  for i in 1..200 loop
    perform public.submit_menu_poll_response(poll, 'voter-' || lpad(i::text, 4, '0'), array[0]);
  end loop;
  begin
    perform public.submit_menu_poll_response(poll, 'voter-0201', array[1]);
    raise exception 'FAIL: 201번째 답이 들어갔어요';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
  perform public.submit_menu_poll_response(poll, 'voter-0001', array[1]);
end $$;

-- 제한 함수는 API(rpc)로 부를 수 없어요
do $$
begin
  if has_function_privilege('anon', 'public.limit_closure_reports()', 'execute') then
    raise exception 'FAIL: 익명이 제한 함수를 부를 수 있어요';
  end if;
end $$;

rollback;
