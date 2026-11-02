-- 방장 키를 null 로 보내면 `host_token <> null` 이 null 이 되어 막히지 않고, 아무나 남의 같이 정하기 메뉴를 확정할 수 있었어요(코드레빗 10-31).
-- null 도 다른 키로 보도록 `is distinct from` 으로 바꿔요. 함수 이름·인자는 그대로라 권한(grant)도 그대로예요.
create or replace function public.confirm_menu_poll(p_poll uuid, p_host_token uuid, p_index integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  poll public.menu_polls;
begin
  select * into poll from public.menu_polls where id = p_poll for update;
  if not found or poll.host_token is distinct from p_host_token then
    raise exception '만든 사람만 정할 수 있어요.' using errcode = '42501';
  end if;
  if poll.confirmed_index is not null then
    raise exception '이미 메뉴를 정했어요.' using errcode = 'P0001';
  end if;
  if p_index is null or p_index < 0 or p_index >= cardinality(poll.options)
     or not exists (select 1 from public.menu_poll_responses where poll_id = p_poll)
     or exists (select 1 from public.menu_poll_responses where poll_id = p_poll and not (p_index = any (accepted))) then
    raise exception '모두 먹을 수 있는 후보가 아니에요.' using errcode = 'P0001';
  end if;
  update public.menu_polls set confirmed_index = p_index, confirmed_at = now() where id = p_poll;
end;
$$;
