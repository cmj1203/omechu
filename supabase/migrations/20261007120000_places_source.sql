-- 가게 정보를 OpenStreetMap 말고 소상공인시장진흥공단 상가(상권)정보에서도 가져와서, 어디서 온 가게인지 적어 둬요.
-- 매달 OpenStreetMap 새로고침이 상가정보 가게를 지우지 않도록, 지우기와 개수 세기를 출처별로 해요.
-- 상가정보 가게의 osm_id 는 'sb' + 상가업소번호예요 (숨긴 가게 표도 이 번호로 기억해요).
alter table public.places add column source text not null default 'osm';

create index places_source_imported_at_idx on public.places (source, imported_at);

notify pgrst, 'reload schema';
