export type Grade = "A" | "B" | "C" | "D"

export type Verdict =
  | "Supported"
  | "Contradicted"
  | "Outdated"
  | "Unsupported"
  | "Needs legal review"

export type Severity = "info" | "low" | "medium" | "high"
export type ReviewEngine = "llm" | "offline"

export interface Rule {
  id: string
  code: string
  type: string
  pattern: string | null
  preferred: string | null
  description: string
  severity: Exclude<Severity, "info">
  source_page: number | null
  canon_version: number
  expires_at: string | null
  active: boolean
}

export interface Fact {
  id: string
  code: string
  statement: string
  keywords?: string[]
  source_page: number | null
  canon_version: number
  expires_at: string | null
}

export interface Finding {
  id?: string
  span_start: number | null
  span_end: number | null
  span_text: string
  rule_id: string | null
  fact_id: string | null
  canon_version: number
  grade: Grade
  verdict: Verdict | null
  source: "rule" | "ai"
  severity: Severity
  explanation: string
  suggested_fix: string | null
}
