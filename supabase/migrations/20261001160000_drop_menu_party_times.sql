-- 추천 화면과 관리자 화면에서 인원·시간을 더 쓰지 않아서, 메뉴 표에서 두 칸을 지워요.
-- 두 칸에 걸려 있던 확인 규칙(check)도 칸과 함께 지워져요.
alter table public.menus
  drop column party,
  drop column times;
