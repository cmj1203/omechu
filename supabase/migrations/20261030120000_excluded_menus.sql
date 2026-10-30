-- 일반 회원이 기본으로 뺄 메뉴(내 계정에서 넣어 두면 메뉴 추천에서 늘 빠져요). 자기 것만 보고 넣고 지울 수 있어요.
-- 메뉴는 menus 번호 대신 이름으로 기억해요(메뉴 목록을 다시 채워도 이름은 그대로라서요).

create table public.excluded_menus (
  user_id uuid not null default auth.uid() references auth.users (id) on delete cascade,
  menu text not null check (char_length(menu) between 1 and 100),
  created_at timestamptz not null default now(),
  primary key (user_id, menu)
);

alter table public.excluded_menus enable row level security;

revoke all on table public.excluded_menus from anon, authenticated;
grant select, insert, delete on public.excluded_menus to authenticated;

create policy "내 제외 메뉴만" on public.excluded_menus
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- 기본으로 뺄 메뉴는 한 사람에 100개까지
create function public.limit_excluded_menus()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (select count(*) from public.excluded_menus where user_id = new.user_id) >= 100 then
    raise exception '기본으로 뺄 메뉴는 100개까지 둘 수 있어요.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger excluded_menus_limit
  before insert on public.excluded_menus
  for each row execute function public.limit_excluded_menus();

revoke all on function public.limit_excluded_menus() from public, anon, authenticated;
