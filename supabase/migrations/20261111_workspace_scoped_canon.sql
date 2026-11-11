-- 20261111_workspace_scoped_canon.sql
-- Scopes rules and facts by workspace for multi-tenant isolation

-- Add workspace_id to rules and facts tables
ALTER TABLE public.rules ADD COLUMN IF NOT EXISTS workspace_id uuid references public.workspaces(id);
ALTER TABLE public.facts ADD COLUMN IF NOT EXISTS workspace_id uuid references public.workspaces(id);

-- Assign existing rules/facts to Default Brand Workspace
UPDATE public.rules SET workspace_id = '00000000-0000-0000-0000-000000000001' WHERE workspace_id IS NULL;
UPDATE public.facts SET workspace_id = '00000000-0000-0000-0000-000000000001' WHERE workspace_id IS NULL;

-- Seed Enterprise Security Team Canon (workspace 002)
INSERT INTO public.rules (code, type, description, pattern, preferred, severity, active, workspace_id, canon_version) VALUES
  ('R-SEC-001', 'absolute_claim', 'No absolute security guarantees without qualification', '100% secure', 'enterprise-grade security controls', 'high', true, '00000000-0000-0000-0000-000000000002', 1),
  ('R-SEC-002', 'absolute_claim', 'No zero-breach guarantees', 'breach-proof', 'hardened security posture', 'high', true, '00000000-0000-0000-0000-000000000002', 1),
  ('R-SEC-003', 'banned_term', 'PCI DSS compliance requires explicit scope qualification', 'PCI DSS compliant', 'PCI DSS in-scope', 'medium', true, '00000000-0000-0000-0000-000000000002', 1),
  ('R-SLA-001', 'absolute_claim', 'SLA uptime claims above 99.9% require enterprise tier qualifier', '99.99% uptime', '99.9% SLA (enterprise tier)', 'medium', true, '00000000-0000-0000-0000-000000000002', 1)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.facts (code, statement, keywords, status, workspace_id, canon_version) VALUES
  ('F-SEC-001', 'AES-256 encryption is applied to all data at rest.', ARRAY['encryption','AES-256','data at rest'], 'active', '00000000-0000-0000-0000-000000000002', 1),
  ('F-SEC-002', 'SOC 2 Type II certification was last renewed in Q2 2026.', ARRAY['SOC 2','certification','compliance'], 'active', '00000000-0000-0000-0000-000000000002', 1),
  ('F-SLA-001', 'The enterprise SLA guarantees 99.9% uptime, not 99.99%.', ARRAY['SLA','uptime','enterprise'], 'active', '00000000-0000-0000-0000-000000000002', 1)
ON CONFLICT (code) DO NOTHING;

-- Seed Judge Demo Workspace (workspace 003)
INSERT INTO public.rules (code, type, description, pattern, preferred, severity, active, workspace_id, canon_version) VALUES
  ('R-DEMO-001', 'absolute_claim', 'Demo: No absolute guarantees', '100% guaranteed', 'backed by our SLA', 'high', true, '00000000-0000-0000-0000-000000000003', 1),
  ('R-DEMO-002', 'banned_term', 'Demo: No disallowed terms', 'Verification Bot', 'ProofGate', 'medium', true, '00000000-0000-0000-0000-000000000003', 1)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.facts (code, statement, keywords, status, workspace_id, canon_version) VALUES
  ('F-DEMO-001', 'ProofGate Pro costs $29 per user per month.', ARRAY['price','ProofGate Pro'], 'active', '00000000-0000-0000-0000-000000000003', 1),
  ('F-DEMO-002', 'Free trial lasts 14 days (the 30-day trial expired 2026-06-30).', ARRAY['free trial','14 days'], 'active', '00000000-0000-0000-0000-000000000003', 1)
ON CONFLICT (code) DO NOTHING;
