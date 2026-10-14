-- 메뉴 종류는 이제 kinds(여러 개)로만 써요. 공개 화면이 kinds 를 읽게 배포된 뒤라 옛 kind 칸을 지워요.
alter table public.menus drop column kind;

notify pgrst, 'reload schema';
