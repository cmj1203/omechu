-- 회원 즐겨찾기·최근 본 가게·탈퇴(20261027130000_member_places.sql). 끝에 되돌려요.
begin;
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-00000000000a', 'a@example.com'),
  ('00000000-0000-0000-0000-00000000000b', 'b@example.com'),
  ('00000000-0000-0000-0000-0000000000ad', 'admin@example.com');
insert into public.admins (user_id) values ('00000000-0000-0000-0000-0000000000ad');

-- 익명은 아예 못 읽어요
set local role anon;
do $$
begin
  perform 1 from public.favorite_places;
  raise exception 'FAIL: 익명이 즐겨찾기를 읽었어요';
exception when insufficient_privilege then null;
end $$;
reset role;

-- A: 즐겨찾기 넣기, 남의 이름으로는 못 넣기
set local role authenticated;
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000a';
insert into public.favorite_places (name, address, lat, lng) values ('A의 김밥', '서울', 37.5, 127.0);
do $$
begin
  insert into public.favorite_places (user_id, name, lat, lng) values ('00000000-0000-0000-0000-00000000000b', '몰래', 37.5, 127.0);
  raise exception 'FAIL: 남의 즐겨찾기를 넣었어요';
exception when insufficient_privilege then null;
end $$;

-- 최근 본 가게: 35곳 넣으면 최근 30곳만, 다시 보면 본 시각만 바뀌어요
do $$
declare i integer;
begin
  for i in 1..35 loop
    insert into public.recent_places (name, lat, lng, viewed_at) values ('가게' || i, 37.5, 127.0, now() - (36 - i) * interval '1 minute');
  end loop;
  if (select count(*) from public.recent_places) <> 30 then
    raise exception 'FAIL: 최근 본 가게가 30곳이 아니에요: %', (select count(*) from public.recent_places);
  end if;
  if exists (select 1 from public.recent_places where name = '가게5') then
    raise exception 'FAIL: 오래된 가게가 남았어요';
  end if;
  insert into public.recent_places (name, lat, lng) values ('가게6', 37.5, 127.0)
    on conflict (user_id, name, lat, lng) do update set viewed_at = now();
  if (select count(*) from public.recent_places) <> 30 then
    raise exception 'FAIL: 다시 본 가게가 따로 늘었어요';
  end if;
end $$;

-- B: A의 것은 안 보이고 못 지워요
set local request.jwt.claim.sub = '00000000-0000-0000-0000-00000000000b';
do $$
begin
  if exists (select 1 from public.favorite_places) or exists (select 1 from public.recent_places) then
    raise exception 'FAIL: B가 A의 가게를 봐요';
  end if;
end $$;
delete from public.favorite_places;
-- 즐겨찾기는 300곳까지
do $$
declare i integer;
begin
  for i in 1..300 loop
    insert into public.favorite_places (name, lat, lng) values ('B가게' || i, 37.5, 127.0);
  end loop;
  begin
    insert into public.favorite_places (name, lat, lng) values ('B가게301', 37.5, 127.0);
    raise exception 'FAIL: 즐겨찾기 301번째가 들어갔어요';
  exception when sqlstate 'P0001' then
    if sqlerrm like 'FAIL%' then raise; end if;
  end;
end $$;

-- 탈퇴: B가 지우면 B의 즐겨찾기도 지워지고, 관리자는 못 지워요
select public.delete_my_account();
set local request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000ad';
do $$
begin
  perform public.delete_my_account();
  raise exception 'FAIL: 관리자 계정이 지워졌어요';
exception when sqlstate 'P0001' then
  if sqlerrm like 'FAIL%' then raise; end if;
end $$;
reset role;
do $$
begin
  if exists (select 1 from auth.users where email = 'b@example.com') then
    raise exception 'FAIL: B 계정이 남았어요';
  end if;
  if exists (select 1 from public.favorite_places where user_id = '00000000-0000-0000-0000-00000000000b') then
    raise exception 'FAIL: B의 즐겨찾기가 남았어요';
  end if;
  if (select count(*) from public.favorite_places where user_id = '00000000-0000-0000-0000-00000000000a') <> 1 then
    raise exception 'FAIL: A의 즐겨찾기가 B 때문에 바뀌었어요';
  end if;
  if has_function_privilege('anon', 'public.delete_my_account()', 'execute') then
    raise exception 'FAIL: 익명이 탈퇴 함수를 부를 수 있어요';
  end if;
end $$;
rollback;
