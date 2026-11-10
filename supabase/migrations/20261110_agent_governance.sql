-- Verity 2.0: store governance reports with each agent trace.
ALTER TABLE agent_traces
ADD COLUMN IF NOT EXISTS governance JSONB;