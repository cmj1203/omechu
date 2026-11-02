-- 11-02 식당 새로고침의 상가정보 단계가 OpenStreetMap 가게를 osm_id 순서로 읽다가 DB 시간 제한에 걸렸어요.
-- osm_id 는 n·r·s(상가정보 62만 곳)·w 순서라서, r 다음을 찾을 때 상가정보 가게를 모두 건너뛰어야 했어요.
-- 출처별로 osm_id 순서를 바로 찾게 색인을 더해요.
create index if not exists places_source_osm_id_idx on public.places (source, osm_id);
