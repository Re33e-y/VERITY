export interface Rule {
  id: string
  created_at: string
  rule_name: string
  category: string
  description: string
  severity: "critical" | "warning" | "info"
}

export interface Fact {
  id: string
  created_at: string
  claim: string
  source_url?: string
  verified: boolean
}

export interface Finding {
  id?: string
  review_run_id?: string
  rule_id?: string
  issue_type: string
  explanation: string
  suggested_fix?: string
}

export interface ReviewRun {
  id: string
  created_at: string
  status: "pending" | "completed" | "flagged"
  target_content: string
  score: number
  findings?: Finding[]
}
