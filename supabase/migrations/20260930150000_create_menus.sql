-- 오메추 메뉴 목록과 관리자.
-- 메뉴는 누구나 볼 수 있고, 추가·수정·삭제는 admins 표에 등록된 계정만 할 수 있어요 (RLS).

create table public.menus (
  id bigint generated always as identity primary key,
  name text not null unique check (char_length(btrim(name)) between 1 and 30),
  kind text not null check (kind in ('식사', '간식', '술')),
  cuisine text not null check (cuisine in ('한식', '중식', '일식', '양식', '아시아')),
  party text[] not null check (cardinality(party) > 0 and party <@ array['1인', '2~4인', '5인~']),
  times text[] not null check (cardinality(times) > 0 and times <@ array['아침', '점심', '저녁', '야식']),
  created_at timestamptz not null default now()
);

create table public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade
);

alter table public.menus enable row level security;
alter table public.admins enable row level security;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.admins where user_id = (select auth.uid()));
$$;

grant select on public.menus to anon, authenticated;
grant insert, update, delete on public.menus to authenticated;
grant select on public.admins to authenticated;

create policy "메뉴는 누구나 볼 수 있음" on public.menus
  for select to anon, authenticated
  using (true);

create policy "관리자만 메뉴 추가" on public.menus
  for insert to authenticated
  with check ((select public.is_admin()));

create policy "관리자만 메뉴 수정" on public.menus
  for update to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "관리자만 메뉴 삭제" on public.menus
  for delete to authenticated
  using ((select public.is_admin()));

create policy "내가 관리자인지만 확인 가능" on public.admins
  for select to authenticated
  using (user_id = (select auth.uid()));
