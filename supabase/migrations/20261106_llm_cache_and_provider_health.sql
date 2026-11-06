-- Verity: persistent LLM cache and provider health log.
-- Run once in the Supabase SQL editor. Safe to re-run.

create table if not exists llm_cache (
  cache_key  text primary key,
  kind       text not null check (kind in ('judge', 'verify')),
  payload    jsonb not null,
  provider   text,
  model      text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists llm_cache_expires_idx on llm_cache (expires_at);

create table if not exists provider_health (
  id         bigint generated always as identity primary key,
  provider   text not null,
  model      text,
  ok         boolean not null,
  error_kind text,
  status     integer,
  latency_ms integer,
  created_at timestamptz not null default now()
);

create index if not exists provider_health_recent_idx on provider_health (provider, created_at desc);

-- Server-side only: the service role bypasses RLS, so with RLS on and no
-- policies, browsers using the anon key cannot read or write these tables.
alter table llm_cache enable row level security;
alter table provider_health enable row level security;

-- Last hour per provider: attempts, failures, average latency.
create or replace view provider_health_last_hour as
select
  provider,
  count(*)                                   as attempts,
  count(*) filter (where not ok)             as failures,
  round(avg(latency_ms) filter (where ok))   as avg_latency_ms,
  max(created_at) filter (where not ok)      as last_failure_at
from provider_health
where created_at > now() - interval '1 hour'
group by provider;

-- Housekeeping. Run occasionally, or schedule with pg_cron if you enable it.
-- delete from llm_cache where expires_at < now();
-- delete from provider_health where created_at < now() - interval '14 days';
