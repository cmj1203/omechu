-- 로컬·CI Postgres에서 supabase/migrations/ 를 돌리려고 Supabase가 기본으로 깔아 두는 것만 흉내 내요.
-- 역할(anon·authenticated·service_role), auth.users, auth.uid(), extensions 스키마의 PostGIS·pg_trgm.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin bypassrls; end if;
end $$;

create schema if not exists extensions;
create extension if not exists postgis schema extensions;
create extension if not exists pg_trgm schema extensions;
grant usage on schema extensions to anon, authenticated, service_role;

create schema if not exists auth;
grant usage on schema auth to anon, authenticated, service_role;
create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- 테스트에서는 set local request.jwt.claim.sub = '<uuid>' 로 로그인한 사람을 정해요.
create or replace function auth.uid() returns uuid
language sql stable
as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

grant usage on schema public to anon, authenticated, service_role;
-- Supabase처럼 새 표·함수의 기본 권한을 세 역할에 줘요(마이그레이션이 필요한 곳에서 거둬요).
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
