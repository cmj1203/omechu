-- '같이 정하기' 투표: 메뉴 추천 화면에서 고른 후보를 링크로 공유하고, 받은 사람이 하나씩 골라요.
-- 로그인 없이 쓰는 기능이에요. 누구나 투표를 만들고 표를 넣을 수 있지만, 고치거나 지우는 건 아무도 못 해요.
-- 투표는 만든 때부터 24시간 뒤에 마감돼요.

-- 후보는 2~5개, 각 1~30자예요(공백만 있는 후보는 안 돼요). check 제약에는 서브쿼리를 못 써서 함수로 봐요.
create function public.menu_poll_options_ok(p_options text[])
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(
    p_options is not null
      and array_ndims(p_options) = 1
      and cardinality(p_options) between 2 and 5
      and not exists (
        select 1
        from unnest(p_options) as candidate
        where candidate is null
           or char_length(btrim(candidate)) < 1
           or char_length(candidate) > 30
      ),
    false
  );
$$;

create table public.menu_polls (
  id uuid primary key default gen_random_uuid(),
  options text[] not null check (public.menu_poll_options_ok(options)),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '24 hours'
);

create table public.menu_poll_votes (
  poll_id uuid not null references public.menu_polls (id) on delete cascade,
  -- 브라우저가 localStorage에 만들어 두는 무작위 글자열이에요. 같은 브라우저는 한 투표에 한 표만 넣을 수 있어요.
  voter text not null check (char_length(voter) between 8 and 64),
  option_index integer not null check (option_index >= 0),
  created_at timestamptz not null default now(),
  primary key (poll_id, voter)
);

alter table public.menu_polls enable row level security;
alter table public.menu_poll_votes enable row level security;

-- Supabase는 새 표에 모든 권한을 기본으로 주니까, 먼저 거두고 읽기와 넣기만 다시 줘요.
-- 넣을 수 있는 칸도 정해 두어서 번호·만든 시각·마감 시각은 항상 기본값이에요.
revoke all on table public.menu_polls from anon, authenticated;
revoke all on table public.menu_poll_votes from anon, authenticated;
grant select on public.menu_polls to anon, authenticated;
grant insert (options) on public.menu_polls to anon, authenticated;
grant select on public.menu_poll_votes to anon, authenticated;
grant insert (poll_id, voter, option_index) on public.menu_poll_votes to anon, authenticated;

create policy "투표는 누구나 볼 수 있음" on public.menu_polls
  for select to anon, authenticated
  using (true);

-- 마감 시각은 기본값(24시간 뒤)만 쓸 수 있어요. 혹시 모르니 25시간 안인지도 봐요.
create policy "투표는 누구나 만들 수 있음" on public.menu_polls
  for insert to anon, authenticated
  with check (expires_at > now() and expires_at <= now() + interval '25 hours');

create policy "표는 누구나 볼 수 있음" on public.menu_poll_votes
  for select to anon, authenticated
  using (true);

-- 있는 후보 번호에만, 마감 전에만 표를 넣을 수 있어요.
create policy "마감 전 투표에만 표 넣기" on public.menu_poll_votes
  for insert to anon, authenticated
  with check (
    exists (
      select 1
      from public.menu_polls as poll
      where poll.id = menu_poll_votes.poll_id
        and menu_poll_votes.option_index < cardinality(poll.options)
        and poll.expires_at > now()
    )
  );

-- 후보별 표 수. 표를 넣은 브라우저 글자열은 돌려주지 않아요.
create function public.menu_poll_results(p_poll uuid)
returns table (option_index integer, votes bigint)
language sql
stable
set search_path = ''
as $$
  select vote.option_index, count(*)::bigint
  from public.menu_poll_votes as vote
  where vote.poll_id = p_poll
  group by vote.option_index
  order by vote.option_index;
$$;

notify pgrst, 'reload schema';
