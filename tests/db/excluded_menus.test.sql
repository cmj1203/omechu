-- 회원이 기본으로 뺄 메뉴(20261030120000_excluded_menus.sql). 끝에 되돌려요.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com');

-- 익명은 아예 못 읽어요
set local role anon;
do $$
begin
  perform 1 from public.excluded_menus;
  raise exception 'FAIL: 익명이 제외 메뉴를 읽었어요';
exception when insufficient_privilege then null;
end $$;
reset role;

-- A: 넣기, 같은 메뉴 두 번은 안 되고, 남의 이름으로는 못 넣기
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.excluded_menus (menu) values ('김치찌개');
do $$
begin
  insert into public.excluded_menus (menu) values ('김치찌개');
  raise exception 'FAIL: 같은 메뉴가 두 번 들어갔어요';
exception when unique_violation then null;
end $$;
do $$
begin
  insert into public.excluded_menus (user_id, menu) values ('00000000-0000-0000-0000-00000000000b', '몰래');
  raise exception 'FAIL: 남의 제외 메뉴를 넣었어요';
exception when insufficient_privilege then null;
end $$;

-- B: A의 것은 안 보이고, 100개까지만
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
declare i integer;
begin
  if exists (select 1 from public.excluded_menus) then
    raise exception 'FAIL: B가 A의 제외 메뉴를 봐요';
  end if;
  for i in 1..100 loop
    insert into public.excluded_menus (menu) values ('메뉴' || i);
  end loop;
  begin
    insert into public.excluded_menus (menu) values ('메뉴101');
    raise exception 'FAIL: 제외 메뉴 101번째가 들어갔어요';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- 탈퇴하면 같이 지워져요
select public.delete_my_account();
reset role;
do $$
begin
  if exists (select 1 from public.excluded_menus where user_id = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'FAIL: B의 제외 메뉴가 남았어요';
  end if;
  if (select count(*) from public.excluded_menus where user_id = '00000000-0000-0000-0000-00000000000a') <> 1 then
    raise exception 'FAIL: A의 제외 메뉴가 바뀌었어요';
  end if;
end $$;
rollback;
