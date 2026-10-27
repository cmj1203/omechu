-- 일반 회원의 즐겨찾기와 최근 본 가게. 자기 것만 보고 넣고 지울 수 있어요(로그인 안 한 사람은 못 써요).
-- 가게는 places 번호 대신 이름·좌표로 기억해요(검색 결과에 가게 번호가 없고, 매달 places 를 새로 채워서 번호가 바뀌어요).

create table public.favorite_places (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  address text check (char_length(address) <= 300),
  lat double precision not null check (lat between 33 and 39),
  lng double precision not null check (lng between 124 and 132),
  created_at timestamptz not null default now(),
  primary key (user_id, name, lat, lng)
);

create table public.recent_places (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 200),
  address text check (char_length(address) <= 300),
  lat double precision not null check (lat between 33 and 39),
  lng double precision not null check (lng between 124 and 132),
  viewed_at timestamptz not null default now(),
  primary key (user_id, name, lat, lng)
);

create index recent_places_user_viewed_idx on public.recent_places (user_id, viewed_at desc);

alter table public.favorite_places enable row level security;
alter table public.recent_places enable row level security;

revoke all on table public.favorite_places from anon, authenticated;
revoke all on table public.recent_places from anon, authenticated;
grant select, insert, delete on public.favorite_places to authenticated;
-- 다시 본 가게는 upsert 로 본 시각만 새로 써요.
grant select, insert, update, delete on public.recent_places to authenticated;

create policy "내 즐겨찾기만" on public.favorite_places
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "내 최근 본 가게만" on public.recent_places
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 즐겨찾기는 한 사람에 300곳까지
create function public.limit_favorite_places()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.favorite_places where user_id = new.user_id) >= 300 then
    raise exception '즐겨찾기는 300곳까지 둘 수 있어요.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger favorite_places_limit
  before insert on public.favorite_places
  for each row execute function public.limit_favorite_places();

-- 최근 본 가게는 한 사람에 최근 30곳만 남겨요.
create function public.trim_recent_places()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  delete from public.recent_places r
  where r.user_id = new.user_id
    and (r.name, r.lat, r.lng) not in (
      select k.name, k.lat, k.lng from public.recent_places k
      where k.user_id = new.user_id
      order by k.viewed_at desc
      limit 30
    );
  return null;
end;
$$;

create trigger recent_places_trim
  after insert or update on public.recent_places
  for each row execute function public.trim_recent_places();

revoke all on function public.limit_favorite_places() from public, anon, authenticated;
revoke all on function public.trim_recent_places() from public, anon, authenticated;

-- 회원 탈퇴: 내 계정을 지우면 즐겨찾기·최근 본 가게도 같이 지워져요(on delete cascade).
-- 관리자 계정은 실수로 지우지 않게 막아요(관리자는 Supabase 대시보드에서 정리).
create function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is null then
    raise exception '로그인해 주세요.' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.admins where user_id = (select auth.uid())) then
    raise exception '관리자 계정은 여기서 지울 수 없어요.' using errcode = 'P0001';
  end if;
  delete from auth.users where id = (select auth.uid());
end;
$$;

revoke all on function public.delete_my_account() from public, anon, authenticated;
grant execute on function public.delete_my_account() to authenticated;
