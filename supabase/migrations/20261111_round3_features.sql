-- 20261111_round3_features.sql
-- Verity Round 3: Workspaces, Versioned Canon, Precedents, and Evaluation Runs

-- 1. Private Workspaces
create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text,
  created_at timestamptz not null default now()
);

-- Seed default workspaces for multi-tenant and judge demo isolation
insert into public.workspaces (id, name, slug, description)
values 
  ('00000000-0000-0000-0000-000000000001', 'Default Brand Workspace', 'default', 'Primary brand governance workspace for production marketing copy'),
  ('00000000-0000-0000-0000-000000000002', 'Enterprise Security Team', 'security', 'Specialized workspace for Infosec, SLA, and Compliance claims'),
  ('00000000-0000-0000-0000-000000000003', 'Judge Demo Workspace', 'judge-demo', 'Isolated sandbox workspace for hackathon evaluation and testing')
on conflict (slug) do nothing;

alter table public.workspaces enable row level security;

-- Add workspace_id to review_runs if not present
alter table public.review_runs 
add column if not exists workspace_id uuid references public.workspaces(id);

-- 2. Versioned Brand Canon Snapshots & Rollback
create table if not exists public.canon_versions (
  version int primary key,
  changelog text not null,
  rules_snapshot jsonb not null default '[]'::jsonb,
  facts_snapshot jsonb not null default '[]'::jsonb,
  created_by text not null default 'System',
  created_at timestamptz not null default now()
);

-- 3. Canon Change Proposals (Governance review before modifying rules)
create table if not exists public.canon_proposals (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id),
  item_type text not null check (item_type in ('rule', 'fact')),
  action text not null check (action in ('create', 'update', 'deprecate')),
  code text not null,
  payload jsonb not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  proposed_by text not null default 'Brand Manager',
  reviewed_by text,
  reviewed_at timestamptz,
  review_note text,
  created_at timestamptz not null default now()
);

-- 4. Precedent Library (Reusing approved exceptions & dismissals)
create table if not exists public.precedents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid references public.workspaces(id),
  finding_type text not null,
  claim_pattern text not null,
  context_keywords text[] default '{}',
  decision text not null check (decision in ('accepted', 'dismissed', 'overridden', 'request_review')),
  reason text not null,
  approved_by text not null default 'Compliance Officer',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create index if not exists precedents_pattern_idx on public.precedents (claim_pattern);

-- 5. Evaluation Runs (Persisted benchmark metrics and regression records)
create table if not exists public.evaluation_runs (
  id uuid primary key default gen_random_uuid(),
  suite_name text not null,
  pipeline_version text not null,
  engine text not null,
  total_cases int not null,
  passed_cases int not null,
  precision numeric(5,2) not null,
  recall numeric(5,2) not null,
  f1_score numeric(5,2) not null,
  false_positives int not null,
  false_negatives int not null,
  latency_avg_ms int not null,
  results jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists evaluation_runs_created_idx on public.evaluation_runs (created_at desc);

-- Security: enable RLS on all new tables
alter table public.canon_versions enable row level security;
alter table public.canon_proposals enable row level security;
alter table public.precedents enable row level security;
alter table public.evaluation_runs enable row level security;
