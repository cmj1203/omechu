-- 로그인 없이 넣을 수 있는 표(가게 문제 알림, 같이 정하기 투표·표)를 스크립트로 도배하지 못하게 막아요.
-- 넘으면 넣기를 거절하고, 화면은 '알리지 못했어요'·'만들지 못했어요'처럼 실패로 보여 줘요.
-- 세는 함수는 넣는 사람(익명)이 못 읽는 줄도 세야 해서 security definer 로 돌려요.

-- 가게 문제 알림: 같은 가게(이름·좌표 약 10m)는 하루 3번, 전체는 한 시간에 300번까지
create index closure_reports_reported_at_idx on public.closure_reports (reported_at);

create function public.limit_closure_reports()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (
    select count(*) from public.closure_reports
    where reported_at > now() - interval '1 day'
      and name = new.name
      and round(lat::numeric, 4) = round(new.lat::numeric, 4)
      and round(lng::numeric, 4) = round(new.lng::numeric, 4)
  ) >= 3 then
    raise exception '이 가게는 오늘 이미 여러 번 알렸어요.' using errcode = 'P0001';
  end if;
  if (select count(*) from public.closure_reports where reported_at > now() - interval '1 hour') >= 300 then
    raise exception '알림이 너무 많아요. 잠시 후 다시 알려 주세요.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger closure_reports_limit
  before insert on public.closure_reports
  for each row execute function public.limit_closure_reports();

-- 같이 정하기 투표: 전체 한 시간에 300개까지
create index menu_polls_created_at_idx on public.menu_polls (created_at);

create function public.limit_menu_polls()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.menu_polls where created_at > now() - interval '1 hour') >= 300 then
    raise exception '투표가 너무 많이 만들어지고 있어요. 잠시 후 다시 만들어 주세요.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger menu_polls_limit
  before insert on public.menu_polls
  for each row execute function public.limit_menu_polls();

-- 표: 브라우저마다 무작위 이름이라 한 사람이 이름을 바꿔 가며 넣을 수 있어서, 투표 하나에 200표까지
create function public.limit_menu_poll_votes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select count(*) from public.menu_poll_votes where poll_id = new.poll_id) >= 200 then
    raise exception '이 투표는 표가 다 찼어요.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

create trigger menu_poll_votes_limit
  before insert on public.menu_poll_votes
  for each row execute function public.limit_menu_poll_votes();

-- 트리거로만 부르는 함수라 API(rpc)로는 못 부르게 해요.
revoke all on function public.limit_closure_reports() from public, anon, authenticated;
revoke all on function public.limit_menu_polls() from public, anon, authenticated;
revoke all on function public.limit_menu_poll_votes() from public, anon, authenticated;
