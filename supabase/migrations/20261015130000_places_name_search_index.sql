-- 상가정보 업종 가게까지 넣어 식당이 72만 곳이 되자, 관리자 '가게 숨기기'의 이름 검색(ilike '%이름%')이 표 전체를 훑다가 시간 제한에 걸렸어요.
-- 이름 일부로 찾는 검색이 인덱스를 쓰게 trigram 인덱스를 더해요.
create extension if not exists pg_trgm with schema extensions;

create index places_name_trgm_idx on public.places using gin (name extensions.gin_trgm_ops);
