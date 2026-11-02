-- 다른 사이트 일식 목록에서 고른 츠케멘(사용자 11-02). 이름에 츠케멘이 든 가게가 적어서 라멘처럼 일식 면 요리 업종으로도 찾아요.
insert into public.menus (name, kinds, cuisine, staple, search_terms, broad_categories) values
  ('츠케멘', array['식사'], '일식', '면', array['츠케멘', '츠케맨', 'tsukemen', '츠케루'], array['일식/일식 면 요리']);
