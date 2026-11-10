-- 20261110_agent_traces.sql
-- Agent traces (auditability) + patches on findings. Safe to re-run.

create table if not exists public.agent_traces (
  id            uuid primary key default gen_random_uuid(),
  review_run_id uuid not null references public.review_runs(id) on delete cascade,
  status        text not null check (status in ('skipped', 'agentic', 'degraded')),
  policy        text not null,
  calls_used    int  not null default 0,
  cache_hit     boolean not null default false,
  plan          jsonb not null,
  trace         jsonb not null,
  suppressed    jsonb not null default '[]'::jsonb,  -- findings the critic hid, with reasons (so humans can audit AI dismissals)
  warnings      jsonb not null default '[]'::jsonb,
  created_at    timestamptz not null default now()
);

create index if not exists agent_traces_review_run_idx on public.agent_traces (review_run_id);

-- Same posture as your other tables: server-side service role only, no anon policies.
alter table public.agent_traces enable row level security;

alter table public.findings add column if not exists patch jsonb;
alter table public.findings add column if not exists ai_notes jsonb;
