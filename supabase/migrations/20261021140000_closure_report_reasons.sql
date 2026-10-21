-- 경고(⚠) 단추로 알린 사유를 남겨요: closed 문 닫음, no_info 정보 없음, not_found 찾을 수 없음.
-- 사유 없이 넣던 예전 알림과 예전 화면에서 오는 알림은 'closed'(문 닫음)로 들어가요.
alter table public.closure_reports
  add column reason text not null default 'closed'
  check (reason in ('closed', 'no_info', 'not_found'));

notify pgrst, 'reload schema';
