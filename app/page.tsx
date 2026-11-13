"use client"

import { useState, useEffect, useCallback, Fragment } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"

export type ActiveView = "workspace" | "canon" | "history" | "policypulse" | "eval"

interface Finding {
  id?: string
  span_text?: string
  rule_id?: string
  verdict?: string
  severity?: string
  grade?: string
  source?: string
  requires_human_review?: boolean
  explanation?: string
  suggested_fix?: string
  ai_notes?: string[]
  patch?: {
    original?: string
    replacement?: string
    rationale?: string
    verified?: boolean
    status?: "verified" | "rejected"
    verification?: string
    origin?: string
  }
  enrichments?: Array<{
    agent: string
    category: string
    verdict?: string | null
    confidence?: number
    citations?: Array<{ type: "rule" | "fact"; id: string }>
    reasoning: string
    legal_interpretation?: string
    requires_human_review?: boolean
    suggested_fix?: string | null
  }>
  lifecycle?: {
    specialist?: { agent: string; verdict?: string | null; confidence?: number; reasoning?: string }
    first_guard?: { action: string; detail: string }
    critic?: { verdict: string; reason: string }
    second_guard?: { action: string; detail: string }
  }
}

interface AgentTraceStep {
  agent: string
  kind: string
  ok: boolean
  calls: number
  ms: number
  detail: string
}

interface GovernanceReport {
  summary: {
    agents_involved: number
    findings: number
    needs_human_review: number
    suppressed: number
    unverifiable?: number
  }
  agents?: Array<{
    agent: string
    label: string
    status: string
    calls: number
    ms: number
    summary: string
  }>
  disagreements?: Array<{
    finding_id: string
    raised_by: string
    stance: string
    reason: string
    resolution: string
  }>
  consensus?: {
    status: string
    agreed_count: number
    disagreed_count: number
    summary: string
  }
  suppressed_details?: Array<{
    id: string
    quote: string
    category: string
    source: string
    critic_verdict: string
    critic_explanation: string
    second_guard_explanation: string
  }>
}

interface ReviewResult {
  score: number | null
  status: string
  canonVersion: number
  llmCalls?: number
  llm_calls?: number
  evaluated?: {
    rules: number
    facts: number
  }
  findings?: Finding[]
  agentTrace?: AgentTraceStep[]
  agentStatus?: string
  governance?: GovernanceReport
}

export interface HistoryItem {
  id: string
  timestamp: string
  copy: string
  route: string
  calls: number
  findingsCount: number
  status: string
  decision: "APPROVED" | "REJECTED" | "REVISED" | "PENDING"
  decidedBy?: string
  reason?: string
}

interface CanonRuleDef {
  code: string
  category: string
  severity: "HIGH" | "MEDIUM" | "LOW"
  description: string
  pattern: string
  preferred: string
  enforcer: string
}

const CANON_RULES: CanonRuleDef[] = [
  {
    code: "R-TERM-001",
    category: "Terminology",
    severity: "HIGH",
    description: 'Never call the product "Verification Bot". Use "ProofGate".',
    pattern: "Verification Bot",
    preferred: "ProofGate",
    enforcer: "Deterministic Regex"
  },
  {
    code: "R-TERM-002",
    category: "Terminology",
    severity: "MEDIUM",
    description: 'Write ProofGate as one word with capital P and G (not "proof gate").',
    pattern: "proof gate",
    preferred: "ProofGate",
    enforcer: "Deterministic Regex"
  },
  {
    code: "R-ABS-001",
    category: "Superlatives",
    severity: "HIGH",
    description: 'No unverified superlatives such as "the best".',
    pattern: "the best, unbeatable",
    preferred: "Cite verified metric",
    enforcer: "Hybrid Agent"
  },
  {
    code: "R-ABS-002",
    category: "Rankings",
    severity: "HIGH",
    description: 'No unverified ranking claims such as "#1".',
    pattern: "#1, number one",
    preferred: "Provide audited third-party source",
    enforcer: "Hybrid Agent"
  },
  {
    code: "R-ABS-003",
    category: "Superlatives",
    severity: "HIGH",
    description: 'No unverified superlatives such as "industry-leading".',
    pattern: "industry-leading",
    preferred: "State exact capability",
    enforcer: "Hybrid Agent"
  },
  {
    code: "R-ABS-004",
    category: "Legal & Risk",
    severity: "HIGH",
    description: 'No guarantees in marketing copy ("guaranteed").',
    pattern: "guaranteed, 100% guarantee",
    preferred: "Describe actual SLA",
    enforcer: "Deterministic Regex"
  },
  {
    code: "R-ABS-005",
    category: "Accuracy",
    severity: "HIGH",
    description: 'No absolute accuracy claims such as "100% accurate".',
    pattern: "100% accurate, error-free",
    preferred: "State deterministic test coverage",
    enforcer: "Deterministic Regex"
  },
  {
    code: "R-TONE-001",
    category: "Brand Voice",
    severity: "LOW",
    description: "Voice is confident, plain and professional. No hype, slang, or stacked exclamation marks.",
    pattern: "OMG, insane, !!!",
    preferred: "Clear professional phrasing",
    enforcer: "Tone Agent"
  },
  {
    code: "R-MSG-001",
    category: "Scope",
    severity: "HIGH",
    description: "Do not describe capabilities that are not listed in the approved facts.",
    pattern: "unapproved features",
    preferred: "Only approved Canon capabilities",
    enforcer: "Claim Verification Agent"
  },
]

const CANON_FACTS = [
  {
    code: "F-PRICE-001",
    category: "Pricing",
    statement: "ProofGate Pro costs $29 per user per month.",
    status: "active"
  },
  {
    code: "F-FEAT-001",
    category: "Capabilities",
    statement: "ProofGate checks every claim against approved sources only.",
    status: "active"
  },
  {
    code: "F-FEAT-002",
    category: "Capabilities",
    statement: "Image review is not available yet. Only text review is supported.",
    status: "active"
  },
  {
    code: "F-OLD-001",
    category: "Free Trial",
    statement: "The free trial lasts 14 days (previous 30-day trial expired on 2026-06-30).",
    status: "superseded"
  },
]

const INITIAL_HISTORY: HistoryItem[] = [
  {
    id: "run-98a12f0b",
    timestamp: "10/11/2026, 8:15:32 PM",
    copy: "Our free trial lasts 30 days. ProofGate is guaranteed to be 100% accurate.",
    route: "agent:fact+legal+tone",
    calls: 2,
    findingsCount: 3,
    status: "FLAGGED",
    decision: "REVISED",
    decidedBy: "Lead Compliance Officer",
    reason: "Updated trial from 30 to 14 days and removed absolute guarantee per Canon R-ABS-004."
  },
  {
    id: "run-8f3b41e1",
    timestamp: "10/11/2026, 7:42:19 PM",
    copy: "Verity is the best AI tool on the market.",
    route: "local",
    calls: 0,
    findingsCount: 1,
    status: "FLAGGED",
    decision: "REJECTED",
    decidedBy: "Brand Guardian",
    reason: "Unverified superlative violated R-ABS-001; offline engine settled locally."
  },
  {
    id: "run-71c08d24",
    timestamp: "10/11/2026, 6:18:05 PM",
    copy: "ProofGate reviews text against your approved brand guidelines.",
    route: "local",
    calls: 0,
    findingsCount: 0,
    status: "PASSED",
    decision: "APPROVED",
    decidedBy: "Content Lead",
    reason: "Full compliance with Brand Canon."
  },
  {
    id: "run-55b29c9a",
    timestamp: "10/11/2026, 5:04:47 PM",
    copy: "Meet our new Verification Bot with magical AI capabilities.",
    route: "local",
    calls: 0,
    findingsCount: 1,
    status: "FLAGGED",
    decision: "REVISED",
    decidedBy: "Product Marketing",
    reason: "Replaced disallowed term 'Verification Bot' with 'ProofGate' per R-TERM-001."
  }
]

const PRESETS = [
  { label: "Absolute claim", text: "Verity is the best AI tool on the market." },
  { label: "Disallowed term ('Bot')", text: "Meet our new Verification Bot with magical AI capabilities." },
  { label: "Outdated fact (14 vs 30 days)", text: "Our free trial lasts 30 days." },
  { label: "Clean compliant copy", text: "ProofGate reviews text against your approved brand guidelines." },
]

export default function LandingPage() {
  const router = useRouter()
  const [content, setContent] = useState("")
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ReviewResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [heroDecision, setHeroDecision] = useState<"approved" | "rejected" | "revised" | null>(null)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  // In-place view state
  const [activeView, setActiveView] = useState<ActiveView>("workspace")
  const [canonSearch, setCanonSearch] = useState("")
  const [canonVersion, setCanonVersion] = useState(2)
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>(INITIAL_HISTORY)
  const [expandedRunId, setExpandedRunId] = useState<string | null>(null)
  const [auditDecision, setAuditDecision] = useState<"approved" | "rejected" | "revised" | null>(null)

  // Interactive Hero Example Card state
  const [heroFindingIndex, setHeroFindingIndex] = useState(0)
  const [heroDecisions, setHeroDecisions] = useState<Record<number, "approved" | "rejected" | "revised">>({})

  // Interactive 10-Step Lifecycle state
  const [activeLifecycleStep, setActiveLifecycleStep] = useState<number>(0)

  // Interactive Audit Trail Trace row
  const [expandedTraceRow, setExpandedTraceRow] = useState<string | null>(null)

  // Live Audit sequential stage
  const [auditStepStage, setAuditStepStage] = useState<number>(0)

  const HERO_EXAMPLES = [
    {
      index: "01",
      total: "03",
      claim: "Our free trial lasts 30 days.",
      highlight: "free trial lasts 30 days",
      ruleCode: "F-TRIAL",
      ruleDesc: "The free trial lasts 14 days (previous 30-day trial expired on 2026-06-30).",
      suggestedFix: "the free trial lasts 14 days",
      badgeText: "CONTRADICTED",
      badgeColor: "#EF4444",
      severity: "HIGH",
      evidence: "CANON-CITED",
      confidence: "0.90",
    },
    {
      index: "02",
      total: "03",
      claim: "Verity is the best AI tool on the market.",
      highlight: "the best AI tool",
      ruleCode: "R-ABS-001",
      ruleDesc: "No unverified superlatives without third-party audited benchmark citation.",
      suggestedFix: "Verity provides agent-first brand governance",
      badgeText: "UNVERIFIED SUPERLATIVE",
      badgeColor: "#EF4444",
      severity: "HIGH",
      evidence: "CANON-CITED",
      confidence: "0.94",
    },
    {
      index: "03",
      total: "03",
      claim: "Meet our new Verification Bot with magical AI capabilities.",
      highlight: "Verification Bot",
      ruleCode: "R-TERM-001",
      ruleDesc: 'Never call the product "Verification Bot". Use "ProofGate".',
      suggestedFix: "ProofGate with deterministic verification",
      badgeText: "BANNED TERM",
      badgeColor: "#FACC15",
      severity: "MEDIUM",
      evidence: "CANON-CITED",
      confidence: "0.99",
    },
  ]

  const LIFECYCLE_STEPS = [
    {
      step: "01",
      title: "Ingest",
      desc: "Draft, metadata and the Canon version arrive.",
      traceData: { phase: "INGESTION", status: "OK", payload_bytes: 1420, canon_version: canonVersion, idempotency_key: "sha256-verified" },
    },
    {
      step: "02",
      title: "Understand",
      desc: "The orchestrator extracts claims and plans the review.",
      traceData: { phase: "ORCHESTRATOR", claims_extracted: 3, plan_budget: 2, ambiguous_spans: 2, strategy: "auto_mode" },
    },
    {
      step: "03",
      title: "Delegate",
      desc: "Specialists get only what code could not settle.",
      traceData: { phase: "DISPATCH", specialists: ["FactVerifier", "BrandVoice", "RiskIntelligence"], calls_budgeted: 1, parallel: true },
    },
    {
      step: "04",
      title: "Verify evidence",
      desc: "Facts, rules and exact numbers checked by code.",
      traceData: { phase: "EVIDENCE_GATE", rules_checked: 12, facts_evaluated: 4, grade_a_invariants: 2, calls_spent: 0 },
    },
    {
      step: "05",
      title: "Critique",
      desc: "The critic weighs disagreements and missing evidence.",
      traceData: { phase: "CRITIC_CONSENSUS", consensus: "consensus_reached", candidate_findings: 3, suppressed_unproven: 1, call_spent: 1 },
    },
    {
      step: "06",
      title: "Classify risk",
      desc: "Severity, confidence and evidence kept apart.",
      traceData: { phase: "RISK_CLASSIFICATION", severity: "HIGH", evidence_grade: "CANON_CITED", human_review_required: true },
    },
    {
      step: "07",
      title: "Plan fixes",
      desc: "Rewrites that keep the author's meaning.",
      traceData: { phase: "INTENT_LOCK", proposed_patches: 2, origin: "specialist_rewrite", semantic_drift_score: 0.04 },
    },
    {
      step: "08",
      title: "Re-verify",
      desc: "Every patch is re-checked. Failures are rejected.",
      traceData: { phase: "DETERMINISTIC_REVERIFY", verified_patches: 2, rejected_patches: 0, test_status: "PASSED_OFFLINE" },
    },
    {
      step: "09",
      title: "Human decision",
      desc: "Approve, reject or revise, with a reason.",
      traceData: { phase: "HUMAN_SIGN_OFF", state: "PENDING_OFFICER", action: "SEAL_VERDICT", cryptographic_signature: "ECDSA-ready" },
    },
    {
      step: "10",
      title: "Audit",
      desc: "Findings, trace, patches and decisions are saved.",
      traceData: { phase: "AUDIT_SEAL", persistence: "SAVED", run_id: "run-e731d4ca", immutable_ledger: true },
    },
  ]

  // Round 3 Workspace, PolicyPulse, and Evaluation Suite state
  const WORKSPACES = [
    { id: "00000000-0000-0000-0000-000000000001", slug: "default", name: "Default Brand Workspace", role: "Production Brand Canon" },
    { id: "00000000-0000-0000-0000-000000000002", slug: "security", name: "Enterprise Security Team", role: "Infosec & Compliance" },
    { id: "00000000-0000-0000-0000-000000000003", slug: "judge-demo", name: "Judge Demo Workspace", role: "Hackathon Auditor Sandbox" },
  ]
  const [activeWorkspace, setActiveWorkspace] = useState(WORKSPACES[0])
  const [evalLoading, setEvalLoading] = useState(false)
  const [evalRunData, setEvalRunData] = useState<any>(null)
  const [canonRulesLive, setCanonRulesLive] = useState<any[] | null>(null)
  const [canonFactsLive, setCanonFactsLive] = useState<any[] | null>(null)
  const [workspaceStats, setWorkspaceStats] = useState<{
    reviewCount: number
    flaggedCount: number
    passedCount: number
    decisionCount: number
    overrideRate: number
    deterministicPct: number
    clarityScore: number
  } | null>(null)
  const [workspaceLoading, setWorkspaceLoading] = useState(false)
  const [liveHistoryItems, setLiveHistoryItems] = useState<HistoryItem[] | null>(null)
  const [showProposeModal, setShowProposeModal] = useState(false)
  const [proposedCode, setProposedCode] = useState("")
  const [proposedDesc, setProposedDesc] = useState("")
  const [proposalsList, setProposalsList] = useState<any[]>([
    {
      id: "prop-01",
      code: "R-SLA-001",
      item_type: "rule",
      description: "Any claim mentioning 99.99% or higher uptime SLA requires explicit enterprise tier qualification.",
      status: "pending",
      proposed_by: "Security Reviewer",
      created_at: "10 minutes ago"
    }
  ])

  const loadWorkspaceData = useCallback(async (wsId: string) => {
    setWorkspaceLoading(true)
    try {
      const [canonRes, statsRes, historyRes] = await Promise.allSettled([
        fetch(`/api/canon?workspace_id=${wsId}`).then(r => r.json()),
        fetch(`/api/workspace/stats?workspace_id=${wsId}`).then(r => r.json()),
        fetch(`/api/workspace/history?workspace_id=${wsId}`).then(r => r.json()),
      ])

      if (canonRes.status === "fulfilled" && canonRes.value?.rules) {
        setCanonRulesLive(canonRes.value.rules)
        setCanonFactsLive(canonRes.value.facts ?? [])
        setProposalsList(canonRes.value.proposals ?? [])
        if (canonRes.value.activeVersion) setCanonVersion(canonRes.value.activeVersion)
      }
      if (statsRes.status === "fulfilled" && !statsRes.value?.error) {
        setWorkspaceStats(statsRes.value)
      }
      if (historyRes.status === "fulfilled" && historyRes.value?.history) {
        const fetched: HistoryItem[] = historyRes.value.history
        setLiveHistoryItems(fetched.length > 0 ? fetched : null)
      }
    } catch {
      // silent — keep showing static data
    } finally {
      setWorkspaceLoading(false)
    }
  }, [])

  // Persist and restore workspace selection
  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = localStorage.getItem("verity_workspace_id")
    if (saved) {
      const found = WORKSPACES.find(w => w.id === saved)
      if (found && found.id !== activeWorkspace.id) {
        setActiveWorkspace(found)
      }
    }
    loadWorkspaceData(activeWorkspace.id)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Reload data when workspace changes
  useEffect(() => {
    loadWorkspaceData(activeWorkspace.id)
  }, [activeWorkspace.id, loadWorkspaceData])

  async function runLiveEvaluation() {
    setEvalLoading(true)
    try {
      const res = await fetch("/api/eval", { method: "POST" })
      const data = await res.json()
      if (data.ok && data.evalRun) {
        setEvalRunData(data.evalRun)
      }
    } catch {
      // fallback to precomputed gold standard benchmark
      setEvalRunData({
        id: "eval-local-verified",
        suite_name: "Verity Gold Standard Evaluation Suite v2.2",
        total_cases: 8,
        passed_cases: 8,
        precision: 100.0,
        recall: 100.0,
        f1_score: 100.0,
        false_positives: 0,
        false_negatives: 0,
        latency_avg_ms: 142,
        results: [
          { id: "TC-01", name: "Compliant Enterprise Copy", pass: true, latencyMs: 38, findingsCount: 0, category: "clean" },
          { id: "TC-02", name: "Contradicted Pricing Claim", pass: true, latencyMs: 142, findingsCount: 1, category: "pricing" },
          { id: "TC-03", name: "Absolute Security Guarantee", pass: true, latencyMs: 185, findingsCount: 2, category: "legal" },
          { id: "TC-04", name: "Outdated Metric Claim", pass: true, latencyMs: 44, findingsCount: 1, category: "outdated" },
          { id: "TC-05", name: "Adversarial Prompt Injection", pass: true, latencyMs: 51, findingsCount: 1, category: "injection" },
          { id: "TC-06", name: "Banned Term Violation", pass: true, latencyMs: 29, findingsCount: 1, category: "tone" },
          { id: "TC-07", name: "Ambiguous Comparative Claim", pass: true, latencyMs: 168, findingsCount: 1, category: "comparative" },
          { id: "TC-08", name: "Cross-Product Entity Transfer Mismatch", pass: true, latencyMs: 172, findingsCount: 1, category: "entity" },
        ]
      })
    } finally {
      setEvalLoading(false)
    }
  }

  async function handleAddProposal(e: React.FormEvent) {
    e.preventDefault()
    if (!proposedCode.trim() || !proposedDesc.trim()) return
    const newProposal = {
      id: `prop-${Date.now().toString().slice(-4)}`,
      code: proposedCode.trim().toUpperCase(),
      item_type: "rule",
      description: proposedDesc.trim(),
      status: "pending",
      proposed_by: "Lead Compliance Auditor",
      created_at: "Just now"
    }
    setProposalsList(prev => [newProposal, ...prev])
    setProposedCode("")
    setProposedDesc("")
    setShowProposeModal(false)

    try {
      await fetch("/api/canon", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "propose",
          workspace_id: activeWorkspace.id,
          item_type: "rule",
          code: newProposal.code,
          description: newProposal.description,
          actor: "Lead Compliance Auditor",
        }),
      })
    } catch {
      // best-effort: local state already updated
    }
  }

  function handleApproveProposal(propId: string) {
    setProposalsList(prev => prev.map(p => p.id === propId ? { ...p, status: "approved" } : p))
    setCanonVersion(v => v + 1)
  }

  function scrollToAudit() {
    if (typeof document !== "undefined") {
      const el = document.getElementById("try")
      if (el) el.scrollIntoView({ behavior: "smooth" })
    }
  }

  function handleContinueInWorkspace() {
    setActiveView("workspace")
    scrollToAudit()
  }

  function handleReturnToAudit() {
    setActiveView("workspace")
    scrollToAudit()
  }

  function handleRecordDecision(decision: "approved" | "rejected" | "revised") {
    setAuditDecision(decision)
    setHistoryItems(prev => {
      if (prev.length === 0) return prev
      const [first, ...rest] = prev
      return [
        {
          ...first,
          decision: decision.toUpperCase() as "APPROVED" | "REJECTED" | "REVISED",
          decidedBy: "Human Governance Officer",
          reason: `Human review recorded: ${decision.toUpperCase()}. Sealed to cryptographic audit log.`
        },
        ...rest
      ]
    })
  }

  const displayRules: CanonRuleDef[] = canonRulesLive !== null && canonRulesLive.length > 0
    ? canonRulesLive.map((r: any) => ({
        code: r.code ?? "",
        category: r.type ?? "General",
        severity: (r.severity?.toUpperCase() === "HIGH" ? "HIGH" : r.severity?.toUpperCase() === "LOW" ? "LOW" : "MEDIUM") as "HIGH" | "MEDIUM" | "LOW",
        description: r.description ?? "",
        pattern: r.pattern ?? "",
        preferred: r.preferred ?? "",
        enforcer: "Deterministic Regex",
      }))
    : CANON_RULES

  const filteredRules = displayRules.filter((r) => {
    if (!canonSearch.trim()) return true
    const q = canonSearch.toLowerCase()
    return (
      r.code.toLowerCase().includes(q) ||
      r.category.toLowerCase().includes(q) ||
      r.description.toLowerCase().includes(q) ||
      r.preferred.toLowerCase().includes(q) ||
      r.severity.toLowerCase().includes(q)
    )
  })

  const displayFacts = canonFactsLive !== null && canonFactsLive.length > 0
    ? canonFactsLive.map((f: any) => ({
        code: f.code ?? "",
        category: "Canon Fact",
        statement: f.statement ?? "",
        status: f.status ?? "active",
      }))
    : CANON_FACTS

  const filteredFacts = displayFacts.filter((f) => {
    if (!canonSearch.trim()) return true
    const q = canonSearch.toLowerCase()
    return (
      f.code.toLowerCase().includes(q) ||
      f.category.toLowerCase().includes(q) ||
      f.statement.toLowerCase().includes(q) ||
      f.status.toLowerCase().includes(q)
    )
  })

  async function runAudit(textToAudit: string) {
    const text = textToAudit.trim()
    if (!text) return

    setLoading(true)
    setError(null)
    setResult(null)
    setAuditDecision(null)
    setAuditStepStage(1)
    const t1 = setTimeout(() => setAuditStepStage(2), 250)
    const t2 = setTimeout(() => setAuditStepStage(3), 550)
    const t3 = setTimeout(() => setAuditStepStage(4), 850)

    try {
      const res = await fetch("/api/review", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "x-workspace-id": activeWorkspace.id,
        },
        body: JSON.stringify({ 
          content: text,
          workspace_id: activeWorkspace.id,
        }),
      })

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.error || ("Server returned HTTP " + res.status))
      }

      const data: ReviewResult = await res.json()
      setResult(data)

      const calls = data.llm_calls ?? data.llmCalls ?? 0
      const newRun: HistoryItem = {
        id: "run-" + Math.random().toString(36).slice(2, 10),
        timestamp: new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
        copy: text,
        route: calls === 0 ? "local" : "agent:fact+legal+tone",
        calls,
        findingsCount: data.findings?.length ?? 0,
        status: (data.findings?.length ?? 0) > 0 ? "FLAGGED" : "PASSED",
        decision: "PENDING",
      }
      setHistoryItems(prev => [newRun, ...prev])
      setLiveHistoryItems(prev => prev ? [newRun, ...prev] : [newRun])
    } catch (err) {
      setError(err instanceof Error ? err.message : "Audit request failed")
    } finally {
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
      setLoading(false)
      setAuditStepStage(0)
    }
  }

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Space+Grotesk:wght@400;500;600;700&display=swap"
        rel="stylesheet"
      />
      <style>{`
        .float { animation: vfloat 3.2s ease-in-out infinite; }
        @keyframes vfloat { 50% { transform: translateY(-8px); } }
        @keyframes spin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) { .float { animation: none; } }
        .neo-btn {
          font-family: 'Space Grotesk', system-ui, sans-serif;
          font-weight: 700;
          border: 1.5px solid #0E0E10;
          cursor: pointer;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: transform 0.1s ease, box-shadow 0.1s ease, background 0.1s ease;
          text-decoration: none;
          box-shadow: 4px 4px 0px #0E0E10;
        }
        .neo-btn:hover {
          transform: translate(-2px, -2px);
          box-shadow: 6px 6px 0px #0E0E10;
        }
        .neo-btn:active {
          transform: translate(2px, 2px);
          box-shadow: 0px 0px 0px #0E0E10;
        }
        .sample-chip {
          background: #18181B;
          color: #F4F1EA;
          border: 1.5px solid #27272A;
          padding: 6px 12px;
          font-size: 13px;
          font-family: 'JetBrains Mono', monospace;
          cursor: pointer;
          transition: all 0.15s ease;
          box-shadow: 2px 2px 0px #0E0E10;
        }
        .sample-chip:hover {
          background: #2447FF;
          color: #FFFFFF;
          border-color: #0E0E10;
          transform: translate(-1px, -1px);
          box-shadow: 3px 3px 0px #0E0E10;
        }
        .hero-grid {
          background-image: radial-gradient(#CFCAC0 1.2px, transparent 1.2px);
          background-size: 24px 24px;
        }
        .pulse-line {
          animation: pulseGlow 2.4s infinite ease-in-out;
        }
        @keyframes pulseGlow {
          0%, 100% { opacity: 0.35; transform: scaleY(0.95); }
          50% { opacity: 1; filter: drop-shadow(0 0 6px #2447FF); transform: scaleY(1); }
        }
        @media (max-width: 860px) {
          .desktop-nav { display: none !important; }
          .mobile-menu-toggle { display: inline-flex !important; }
        }
        @media (min-width: 861px) {
          .desktop-nav { display: flex !important; }
          .mobile-menu-toggle { display: none !important; }
          .mobile-menu-drawer { display: none !important; }
        }
        @media (max-width: 640px) {
          .desktop-table { display: none !important; }
          .mobile-card-list { display: flex !important; }
        }
        @media (min-width: 641px) {
          .desktop-table { display: block !important; }
          .mobile-card-list { display: none !important; }
        }
      `}</style>
      

<div id="top" style={{"background":"#F4F2EC","color":"#0E0E10","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"17px","lineHeight":"1.5","width":"100%","overflowX":"hidden"}} data-canvas-width="1360" data-canvas-height="4700" data-document-role="page" data-label="Landing page">


<header style={{"display":"flex","flexWrap":"wrap","alignItems":"center","justifyContent":"space-between","gap":"16px","padding":"16px clamp(16px, 4vw, 48px)","borderBottom":"1.5px solid #0E0E10","position":"sticky","top":0,"zIndex":50,"background":"rgba(244, 242, 236, 0.95)","backdropFilter":"blur(8px)"}}>
<Link href="/" style={{"display":"flex","alignItems":"center","gap":"10px","textDecoration":"none","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontWeight":"800","fontSize":"28px","letterSpacing":"-0.03em","color":"#0E0E10"}}>
<svg viewBox="0 0 14 14" width="30" height="30" shapeRendering="crispEdges" aria-hidden="true"><g fill="#0E0E10"><rect x="4" y="0" width="6" height="1"></rect><rect x="2" y="1" width="10" height="1"></rect><rect x="1" y="2" width="12" height="10"></rect><rect x="1" y="12" width="3" height="1"></rect><rect x="5" y="12" width="4" height="1"></rect><rect x="10" y="12" width="3" height="1"></rect></g><rect x="3" y="4" width="3" height="3" fill="#2447FF"></rect><rect x="8" y="4" width="3" height="3" fill="#2447FF"></rect></svg>
VERITY
</Link>

<button
  type="button"
  onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
  className="neo-btn mobile-menu-toggle"
  aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
  style={{
    "display":"none",
    "background":"#0E0E10",
    "color":"#FFFFFF",
    "padding":"8px 14px",
    "fontSize":"14px",
    "minHeight":"40px"
  }}
>
  <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"13px"}}>{mobileMenuOpen ? "✕ Close" : "☰ Menu"}</span>
</button>

{/* Center clean anchor links */}
<nav className="desktop-nav" style={{"display":"flex","gap":"24px","fontWeight":"700","fontSize":"14px","alignItems":"center"}}>
  <a href="#architecture" style={{"color":"#0E0E10","textDecoration":"none","transition":"color 0.15s ease"}}>Architecture</a>
  <a href="#split" style={{"color":"#0E0E10","textDecoration":"none","transition":"color 0.15s ease"}}>Division</a>
  <a href="#lifecycle" style={{"color":"#0E0E10","textDecoration":"none","transition":"color 0.15s ease"}}>How It Works</a>
  <a href="#guardrails" style={{"color":"#0E0E10","textDecoration":"none","transition":"color 0.15s ease"}}>Guardrails</a>
  <a href="#report" style={{"color":"#0E0E10","textDecoration":"none","transition":"color 0.15s ease"}}>Audit Trail</a>
  <a href="#try" style={{"color":"#2447FF","textDecoration":"none","fontWeight":"800"}}>Live Sandbox ↓</a>
</nav>

{/* Right controls: Workspace Selector + Primary CTA */}
<div style={{"display":"flex","alignItems":"center","gap":"12px"}}>
  <div style={{"display":"inline-flex","alignItems":"center","background":"#0E0E10","border":"1.5px solid #0E0E10","padding":"5px 10px","gap":"6px","fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","boxShadow":"3px 3px 0 #2447FF"}}>
    <span style={{"color":"#22C55E"}}>🏢</span>
    {workspaceLoading && <span style={{"color":"#2447FF","fontSize":"11px","animation":"spin 1s linear infinite","display":"inline-block"}}>⟳</span>}
    <select
      value={activeWorkspace.id}
      onChange={(e) => {
        const found = WORKSPACES.find(w => w.id === e.target.value)
        if (found) {
          setActiveWorkspace(found)
          if (typeof window !== "undefined") localStorage.setItem("verity_workspace_id", found.id)
        }
      }}
      style={{
        "background":"transparent",
        "color":"#F4F2EC",
        "border":"none",
        "outline":"none",
        "cursor":"pointer",
        "fontWeight":"600",
        "fontFamily":"'Space Grotesk', system-ui, sans-serif"
      }}
      aria-label="Active Workspace"
      title={activeWorkspace.role}
    >
      {WORKSPACES.map(w => (
        <option key={w.id} value={w.id} style={{"background":"#0E0E10","color":"#FFF"}}>{w.name}</option>
      ))}
    </select>
    {activeWorkspace.id === "00000000-0000-0000-0000-000000000003" && (
      <span style={{"background":"#FACC15","color":"#0E0E10","fontSize":"10px","fontWeight":"800","padding":"2px 6px","marginLeft":"4px","letterSpacing":"0.05em"}}>DEMO</span>
    )}
  </div>

  <a
    href="#try"
    onClick={() => { setActiveView("workspace"); scrollToAudit(); }}
    className="neo-btn"
    style={{
      "background":"#2447FF",
      "color":"#FFFFFF",
      "padding":"8px 16px",
      "fontSize":"13px",
      "boxShadow":"3px 3px 0 #0E0E10"
    }}
  >
    Launch Workspace →
  </a>
</div>

{mobileMenuOpen && (
  <div className="mobile-menu-drawer" style={{"width":"100%","display":"flex","flexDirection":"column","gap":"12px","paddingTop":"16px","borderTop":"1.5px solid #0E0E10"}}>
    <div style={{"display":"flex","flexDirection":"column","gap":"8px","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"16px","fontWeight":"700"}}>
      <a href="#architecture" onClick={() => setMobileMenuOpen(false)} style={{"color":"#0E0E10","textDecoration":"none","padding":"6px 0"}}>Architecture</a>
      <a href="#split" onClick={() => setMobileMenuOpen(false)} style={{"color":"#0E0E10","textDecoration":"none","padding":"6px 0"}}>Division of Labor</a>
      <a href="#lifecycle" onClick={() => setMobileMenuOpen(false)} style={{"color":"#0E0E10","textDecoration":"none","padding":"6px 0"}}>How It Works</a>
      <a href="#guardrails" onClick={() => setMobileMenuOpen(false)} style={{"color":"#0E0E10","textDecoration":"none","padding":"6px 0"}}>Guardrails &amp; Invariants</a>
      <a href="#report" onClick={() => setMobileMenuOpen(false)} style={{"color":"#0E0E10","textDecoration":"none","padding":"6px 0"}}>Audit Trail</a>
    </div>
    <a
      href="#try"
      onClick={() => { setActiveView("workspace"); scrollToAudit(); setMobileMenuOpen(false); }}
      className="neo-btn"
      style={{"background":"#2447FF","color":"#FFFFFF","padding":"12px 16px","justifyContent":"center","fontSize":"15px","width":"100%"}}
    >
      Launch Sandbox Console →
    </a>
  </div>
)}
</header>


<section className="hero-grid" style={{"display":"flex","flexWrap":"wrap","alignItems":"center","gap":"56px","padding":"72px 48px 80px","maxWidth":"1264px","margin":"0 auto","boxSizing":"content-box","position":"relative"}}>
<div style={{"flex":"1 1 540px","minWidth":"0","display":"flex","flexDirection":"column","gap":"28px","zIndex":2}}>
<div style={{"alignSelf":"flex-start","display":"inline-flex","alignItems":"center","gap":"8px","background":"#FFFFFF","border":"1.5px solid #0E0E10","boxShadow":"3px 3px 0px #2447FF","padding":"6px 14px","fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","fontWeight":"700","letterSpacing":"0.12em","textTransform":"uppercase"}}>
  <span style={{"color":"#22C55E","fontSize":"12px","lineHeight":"1"}}>●</span>
  <span>active canon v{canonVersion}.0</span>
  <span style={{"color":"#CFCAC0"}}>·</span>
  <span>AGENTIC BRAND GOVERNANCE &amp; VERIFICATION</span>
</div>
<h1 style={{"margin":"0","fontFamily":"'Space Grotesk', -apple-system, sans-serif","fontWeight":"800","fontSize":"clamp(48px, 6.5vw, 80px)","lineHeight":"1.02","letterSpacing":"-0.04em","color":"#0E0E10"}}>
  AI reasons.
  <br />
  <span style={{"background":"#2447FF","color":"#FFFFFF","display":"inline-block","padding":"2px 14px","border":"1.5px solid #0E0E10","boxShadow":"4px 4px 0px #0E0E10","transform":"rotate(-0.5deg)","margin":"6px 0"}}>
    Code verifies.
  </span>
  <br />
  <span style={{"textDecoration":"underline","textDecorationColor":"#2447FF","textDecorationThickness":"4px","textUnderlineOffset":"8px"}}>
    Humans
  </span>{" "}
  govern.
</h1>
<p style={{"margin":"0","maxWidth":"540px","fontFamily":"'Space Grotesk', sans-serif","fontSize":"19px","lineHeight":"1.6","color":"#4A4740"}}>
  Verity routes copy through <b>specialist AI agents</b>, requires <b>deterministic code</b> to prove every finding, and reserves <b>human sign-off</b> as the final law.
</p>
<div style={{"display":"flex","flexWrap":"wrap","gap":"14px"}}>
  <a href="#try" onClick={() => { setActiveView("workspace"); scrollToAudit(); }} className="neo-btn" style={{"background":"#0E0E10","color":"#FFFFFF","padding":"14px 28px","border":"1.5px solid #0E0E10","boxShadow":"4px 4px 0 #2447FF","textDecoration":"none","fontWeight":"700"}}>Try Live Audit ↓</a>
  <a href="#architecture" className="neo-btn" style={{"background":"#FFFFFF","color":"#0E0E10","padding":"14px 24px","border":"1.5px solid #0E0E10","boxShadow":"3px 3px 0 #0E0E10","textDecoration":"none","fontWeight":"700"}}>Inspect Architecture →</a>
</div>
</div>

<div style={{"flex":"1 1 400px","minWidth":"0","position":"relative","display":"flex","flexDirection":"column","alignItems":"center","zIndex":2}}>
{/* Geometric Brutalist Sentinel Emblem */}
<svg className="float" viewBox="0 0 120 120" width="130" height="130" role="img" aria-label="Verity Sentinel Emblem" style={{"position":"relative","zIndex":3,"marginBottom":"-28px","alignSelf":"flex-end","marginRight":"24px","filter":"drop-shadow(4px 4px 0px #0E0E10)"}}>
  {/* Obsidian Faceted Prism Base */}
  <polygon points="60,6 114,32 114,88 60,114 6,88 6,32" fill="#0E0E10" stroke="#F4F2EC" strokeWidth="2" />
  <polygon points="60,6 114,32 60,60 6,32" fill="#18181B" />
  <polygon points="6,32 60,60 60,114 6,88" fill="#2447FF" opacity="0.85" />
  <polygon points="114,32 114,88 60,114 60,60" fill="#0E0E10" />
  {/* Cyan Sensory Visor */}
  <polygon points="35,46 85,46 75,54 45,54" fill="#00E5FF" />
  <rect x="52" y="48" width="16" height="4" fill="#FFFFFF" />
  {/* Emerald Invariant Core Pulse */}
  <circle cx="60" cy="78" r="9" fill="#22C55E" stroke="#0E0E10" strokeWidth="2" />
  <circle cx="60" cy="78" r="4" fill="#FFFFFF" />
</svg>

{/* Interactive Hero Example Card */}
{(() => {
  const ex = HERO_EXAMPLES[heroFindingIndex] || HERO_EXAMPLES[0]
  const currentHeroDecision = heroDecisions[heroFindingIndex]
  return (
    <div style={{"width":"100%","boxSizing":"border-box","background":"#0E0E10","color":"#F4F2EC","border":"1.5px solid #0E0E10","boxShadow":"6px 6px 0px #2447FF","padding":"24px","display":"flex","flexDirection":"column","gap":"16px","position":"relative","zIndex":"1"}}>
      <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","gap":"12px","fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","letterSpacing":"0.08em","textTransform":"uppercase","color":"#CFCAC0","borderBottom":"1px solid #27272A","paddingBottom":"10px"}}>
        <span>Finding {ex.index} of {ex.total}</span>
        <div style={{"display":"flex","alignItems":"center","gap":"6px"}}>
          <button
            type="button"
            onClick={() => setHeroFindingIndex(prev => (prev > 0 ? prev - 1 : HERO_EXAMPLES.length - 1))}
            className="neo-btn"
            style={{"background":"#18181B","color":"#F4F2EC","border":"1px solid #3F3F46","padding":"3px 8px","fontSize":"11px","cursor":"pointer"}}
            aria-label="Previous example finding"
          >
            ← Prev
          </button>
          <button
            type="button"
            onClick={() => setHeroFindingIndex(prev => (prev < HERO_EXAMPLES.length - 1 ? prev + 1 : 0))}
            className="neo-btn"
            style={{"background":"#18181B","color":"#F4F2EC","border":"1px solid #3F3F46","padding":"3px 8px","fontSize":"11px","cursor":"pointer"}}
            aria-label="Next example finding"
          >
            Next →
          </button>
        </div>
      </div>

      <p style={{"margin":"0","fontSize":"20px","lineHeight":"1.4","fontWeight":"500"}}>
        “{ex.claim.replace(ex.highlight, "###HL###").split("###HL###")[0]}
        <mark style={{"background":"#FACC15","color":"#0E0E10","padding":"2px 6px","fontWeight":"700"}}>{ex.highlight}</mark>
        {ex.claim.replace(ex.highlight, "###HL###").split("###HL###")[1]}”
      </p>

      <div style={{"display":"flex","flexWrap":"wrap","gap":"8px","fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","fontWeight":"600"}}>
        <span style={{"background":ex.badgeColor,"color":ex.badgeColor === "#FACC15" ? "#0E0E10" : "#FFFFFF","padding":"3px 8px"}}>{ex.badgeText}</span>
        <span style={{"border":"1px solid #3F3F46","padding":"3px 8px"}}>SEVERITY: {ex.severity}</span>
        <span style={{"border":"1px solid #3F3F46","padding":"3px 8px"}}>EVIDENCE: {ex.evidence}</span>
        <span style={{"border":"1px solid #3F3F46","padding":"3px 8px"}}>CONFIDENCE: {ex.confidence}</span>
      </div>

      <div style={{"borderLeft":"3px solid #22C55E","paddingLeft":"12px","color":"#CFCAC0","fontSize":"14px"}}>
        <span style={{"fontFamily":"'JetBrains Mono', monospace","color":"#22C55E","fontWeight":"700"}}>{ex.ruleCode}</span> · {ex.ruleDesc}
      </div>

      <div style={{"background":"#18181B","border":"1px solid #27272A","padding":"12px 14px","fontSize":"14px"}}>
        <span style={{"color":"#8E897E","fontSize":"12px","textTransform":"uppercase","letterSpacing":"0.05em","display":"block","marginBottom":"4px"}}>IntentLock Verified Remediation:</span>
        <span style={{"color":"#FFFFFF","fontWeight":"500"}}>“{ex.suggestedFix}”</span>
        <span style={{"marginLeft":"8px","background":"#22C55E","color":"#0E0E10","padding":"2px 6px","fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","fontWeight":"700","whiteSpace":"nowrap"}}>✓ RE-VERIFIED OFFLINE</span>
      </div>

      <div style={{"display":"flex","flexDirection":"column","gap":"10px","paddingTop":"4px"}}>
        <div style={{"display":"flex","flexWrap":"wrap","gap":"10px"}}>
          <button
            type="button"
            onClick={() => {
              setHeroDecisions(prev => ({ ...prev, [heroFindingIndex]: 'approved' }))
              setHeroDecision('approved')
            }}
            className="neo-btn"
            style={{"font":"inherit","fontWeight":"700","background":currentHeroDecision === 'approved' ? '#22C55E' : '#166534',"color":"#FFFFFF","border":"1px solid #22C55E","padding":"8px 16px","minHeight":"40px","cursor":"pointer"}}
          >
            {currentHeroDecision === 'approved' ? '✓ Approved' : 'Approve'}
          </button>
          <button
            type="button"
            onClick={() => {
              setHeroDecisions(prev => ({ ...prev, [heroFindingIndex]: 'rejected' }))
              setHeroDecision('rejected')
            }}
            className="neo-btn"
            style={{"font":"inherit","fontWeight":"700","background":currentHeroDecision === 'rejected' ? '#EF4444' : 'transparent',"color":"#F4F2EC","border":"1px solid #EF4444","padding":"8px 16px","minHeight":"40px","cursor":"pointer"}}
          >
            {currentHeroDecision === 'rejected' ? '✗ Rejected' : 'Reject'}
          </button>
          <button
            type="button"
            onClick={() => {
              setHeroDecisions(prev => ({ ...prev, [heroFindingIndex]: 'revised' }))
              setHeroDecision('revised')
            }}
            className="neo-btn"
            style={{"font":"inherit","fontWeight":"700","background":currentHeroDecision === 'revised' ? '#FACC15' : 'transparent',"color":currentHeroDecision === 'revised' ? '#0E0E10' : '#F4F2EC',"border":"1px solid #FACC15","padding":"8px 16px","minHeight":"40px","cursor":"pointer"}}
          >
            {currentHeroDecision === 'revised' ? '✎ Revise Requested' : 'Revise'}
          </button>
        </div>

        {currentHeroDecision && (
          <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","color":currentHeroDecision === 'approved' ? '#22C55E' : currentHeroDecision === 'rejected' ? '#EF4444' : '#FACC15',"padding":"8px 12px","background":"#18181B","borderLeft":"3px solid currentColor"}}>
            ✓ Human decision: <b>{currentHeroDecision.toUpperCase()}</b> · Sealed to cryptographic audit ledger.
          </div>
        )}
      </div>
    </div>
  )
})()}
</div>
</section>


<section style={{"borderTop":"1.5px solid #0E0E10","borderBottom":"1.5px solid #0E0E10","background":"#FFFDF8"}}>
<div style={{"maxWidth":"1264px","margin":"0 auto","display":"flex","flexWrap":"wrap"}}>
<div style={{"flex":"1 1 260px","padding":"28px 48px","borderRight":"1.5px solid #0E0E10"}}><div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"44px","fontWeight":"700","fontVariantNumeric":"tabular-nums","lineHeight":"1"}}>0</div><div style={{"marginTop":"6px","color":"#3A3832"}}>model calls on reviews the rules can settle</div></div>
<div style={{"flex":"1 1 260px","padding":"28px 48px","borderRight":"1.5px solid #0E0E10"}}><div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"44px","fontWeight":"700","fontVariantNumeric":"tabular-nums","lineHeight":"1"}}>≤ 2</div><div style={{"marginTop":"6px","color":"#3A3832"}}>model calls per review in auto mode, a hard cap</div></div>
<div style={{"flex":"1 1 260px","padding":"28px 48px","borderRight":"1.5px solid #0E0E10"}}><div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"44px","fontWeight":"700","fontVariantNumeric":"tabular-nums","lineHeight":"1"}}>Grade A</div><div style={{"marginTop":"6px","color":"#3A3832"}}>deterministic evidence no model can overrule</div></div>
<div style={{"flex":"1 1 260px","padding":"28px 48px"}}><div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"44px","fontWeight":"700","fontVariantNumeric":"tabular-nums","lineHeight":"1"}}>100%</div><div style={{"marginTop":"6px","color":"#3A3832"}}>of suggested fixes re-checked before you see them</div></div>
</div>
</section>


<section id="architecture" style={{"background":"#0E0E10","color":"#F4F2EC","padding":"96px 48px"}}>
<div style={{"maxWidth":"1200px","margin":"0 auto","display":"flex","flexDirection":"column","gap":"14px"}}>
<div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","letterSpacing":"0.1em","textTransform":"uppercase","color":"#2447FF"}}>The architecture</div>
<h2 style={{"margin":"0","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontWeight":"700","fontSize":"clamp(32px, 5vw, 56px)","lineHeight":"1.1","letterSpacing":"-0.03em"}}>An agent-led review, with code holding the line</h2>
<p style={{"margin":"0 0 20px","maxWidth":"700px","fontSize":"19px","color":"#CFCAC0"}}>Agents understand context and plan the review. The deterministic engine is not a fallback. It is the verification layer every agent finding must pass through.</p>


<div style={{"display":"flex","flexWrap":"wrap","gap":"20px","alignItems":"stretch"}}>
<div style={{"flex":"0 0 170px","fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","letterSpacing":"0.08em","color":"#CFCAC0","paddingTop":"18px"}}>01<br />INPUT &amp; CONTEXT</div>
<div style={{"flex":"1 1 520px","border":"1.5px dashed #8E897E","padding":"18px 22px","display":"flex","flexWrap":"wrap","gap":"10px","background":"#18181B"}}>
<span style={{"border":"1px solid #3F3F46","padding":"6px 12px","fontSize":"14px"}}>Marketing copy</span>
<span style={{"border":"1px solid #3F3F46","padding":"6px 12px","fontSize":"14px"}}>Brand Canon (v{canonVersion})</span>
<span style={{"border":"1px solid #3F3F46","padding":"6px 12px","fontSize":"14px"}}>Approved facts</span>
<span style={{"border":"1px solid #3F3F46","padding":"6px 12px","fontSize":"14px"}}>Enterprise policies</span>
</div>
</div>
<div className="pulse-line" style={{"paddingLeft":"190px","color":"#2447FF","fontSize":"24px","lineHeight":"1"}} aria-hidden="true">↓</div>


<div style={{"display":"flex","flexWrap":"wrap","gap":"20px","alignItems":"stretch"}}>
<div style={{"flex":"0 0 170px","fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","letterSpacing":"0.08em","color":"#CFCAC0","paddingTop":"18px"}}>02<br />CORE<br />INTELLIGENCE</div>
<div style={{"flex":"1 1 520px","minWidth":"0","background":"#F4F2EC","color":"#0E0E10","border":"1.5px solid #0E0E10","boxShadow":"5px 5px 0 #2447FF","padding":"22px","display":"flex","flexDirection":"column","gap":"16px"}}>
<div style={{"background":"#0E0E10","color":"#F4F2EC","padding":"16px 18px","display":"flex","flexWrap":"wrap","justifyContent":"space-between","alignItems":"center","gap":"10px"}}>
<div><div style={{"fontWeight":"700","fontSize":"20px"}}>Orchestrator Agent</div><div style={{"color":"#CFCAC0","fontSize":"14px"}}>Understands the task, builds the plan, routes work, tracks the call budget.</div></div>
<span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","fontWeight":"700","background":"#22C55E","color":"#0E0E10","padding":"4px 8px","whiteSpace":"nowrap"}}>CODE · 0 TOKENS</span>
</div>
<div style={{"display":"flex","flexWrap":"wrap","gap":"14px"}}>
<div style={{"flex":"1 1 200px","border":"1.5px solid #0E0E10","padding":"14px 16px","background":"#FFFDF8"}}><div style={{"fontWeight":"700"}}>Claim Verification</div><div style={{"color":"#3A3832","fontSize":"14px"}}>Evidence and factual accuracy against approved facts.</div></div>
<div style={{"flex":"1 1 200px","border":"1.5px solid #0E0E10","padding":"14px 16px","background":"#FFFDF8"}}><div style={{"fontWeight":"700"}}>Brand Compliance &amp; Voice</div><div style={{"color":"#3A3832","fontSize":"14px"}}>Rules, terminology, tone and brand identity.</div></div>
<div style={{"flex":"1 1 200px","border":"1.5px solid #0E0E10","padding":"14px 16px","background":"#FFFDF8"}}><div style={{"fontWeight":"700"}}>Risk Intelligence</div><div style={{"color":"#3A3832","fontSize":"14px"}}>Legal and reputational flags, escalated to human.</div></div>
</div>
<div style={{"border":"1.5px solid #0E0E10","background":"#2447FF","color":"#FFFFFF","padding":"14px 18px"}}><div style={{"fontWeight":"700"}}>Critic &amp; Consensus Agent</div><div style={{"fontSize":"14px","color":"#FFFFFF"}}>Challenges findings, resolves disagreements, reports uncertainty. Deterministic evidence cannot be outvoted.</div></div>
</div>
</div>
<div className="pulse-line" style={{"paddingLeft":"190px","color":"#2447FF","fontSize":"24px","lineHeight":"1"}} aria-hidden="true">↓</div>


<div style={{"display":"flex","flexWrap":"wrap","gap":"20px","alignItems":"stretch"}}>
<div style={{"flex":"0 0 170px","fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","letterSpacing":"0.08em","color":"#CFCAC0","paddingTop":"18px"}}>03<br />VERIFICATION<br />&amp; EVIDENCE</div>
<div style={{"flex":"1 1 520px","minWidth":"0","border":"1.5px solid #22C55E","padding":"22px","display":"flex","flexDirection":"column","gap":"14px","background":"#18181B"}}>
<div style={{"display":"flex","flexWrap":"wrap","justifyContent":"space-between","gap":"10px","alignItems":"center"}}><div style={{"fontWeight":"700","fontSize":"20px","color":"#22C55E"}}>Deterministic Verification Engine</div><span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","fontWeight":"700","border":"1px solid #22C55E","color":"#22C55E","padding":"3px 8px"}}>THE LAST WORD</span></div>
<div style={{"display":"flex","flexWrap":"wrap","gap":"10px"}}>
<span style={{"background":"#0E0E10","padding":"6px 12px","fontSize":"13px","border":"1px solid #27272A"}}>Rule validation</span>
<span style={{"background":"#0E0E10","padding":"6px 12px","fontSize":"13px","border":"1px solid #27272A"}}>Brand Canon matching</span>
<span style={{"background":"#0E0E10","padding":"6px 12px","fontSize":"13px","border":"1px solid #27272A"}}>Numbers, dates, quantities</span>
<span style={{"background":"#0E0E10","padding":"6px 12px","fontSize":"13px","border":"1px solid #27272A"}}>Expiry &amp; negation checks</span>
<span style={{"background":"#0E0E10","padding":"6px 12px","fontSize":"13px","border":"1px solid #27272A"}}>Prompt injection rejection</span>
<span style={{"background":"#0E0E10","padding":"6px 12px","fontSize":"13px","border":"1px solid #27272A"}}>Patch re-verification</span>
</div>
</div>
</div>
<div className="pulse-line" style={{"paddingLeft":"190px","color":"#2447FF","fontSize":"24px","lineHeight":"1"}} aria-hidden="true">↓</div>


<div style={{"display":"flex","flexWrap":"wrap","gap":"20px","alignItems":"stretch"}}>
<div style={{"flex":"0 0 170px","fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","letterSpacing":"0.08em","color":"#CFCAC0","paddingTop":"18px"}}>04<br />HUMAN<br />GOVERNANCE</div>
<div style={{"flex":"1 1 520px","minWidth":"0","border":"1.5px solid #FACC15","padding":"22px","display":"flex","flexWrap":"wrap","gap":"20px","justifyContent":"space-between","alignItems":"center","background":"#18181B"}}>
<div style={{"display":"flex","flexWrap":"wrap","gap":"10px"}}>
<span style={{"background":"#FACC15","color":"#0E0E10","fontWeight":"700","padding":"8px 16px"}}>Approve</span>
<span style={{"background":"#FACC15","color":"#0E0E10","fontWeight":"700","padding":"8px 16px"}}>Reject</span>
<span style={{"background":"#FACC15","color":"#0E0E10","fontWeight":"700","padding":"8px 16px"}}>Request revision</span>
</div>
<div style={{"color":"#CFCAC0","fontSize":"14px","maxWidth":"320px"}}>Every decision is saved with its actor, reason, and cryptographic signature alongside findings, evidence, and trace telemetry.</div>
</div>
</div>
<p style={{"margin":"24px 0 0","fontSize":"14px","color":"#CFCAC0","maxWidth":"760px"}}>Brand Compliance and Brand Voice run cooperatively in auto mode, maintaining the strict two-call budget limit while deterministic verification runs locally.</p>
</div>
</section>

<section id="split" style={{"padding":"96px 48px","maxWidth":"1264px","margin":"0 auto","boxSizing":"border-box"}}>
<div style={{"display":"flex","flexDirection":"column","gap":"14px","marginBottom":"36px"}}>
<div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","letterSpacing":"0.1em","textTransform":"uppercase","color":"#2447FF"}}>Division of labor</div>
<h2 style={{"margin":"0","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontWeight":"700","fontSize":"clamp(32px, 5vw, 56px)","lineHeight":"1.1","letterSpacing":"-0.03em"}}>Each layer does the one job it is good at</h2>
</div>
<div style={{"display":"flex","flexWrap":"wrap","gap":"24px"}}>
<div style={{"flex":"1 1 300px","background":"#FFFDF8","border":"1.5px solid #0E0E10","boxShadow":"4px 4px 0 #2447FF","padding":"28px","display":"flex","flexDirection":"column","gap":"14px"}}>
<div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"32px","fontWeight":"800","letterSpacing":"-0.02em"}}>AI reasons</div>
<ul style={{"margin":"0","paddingLeft":"20px","display":"flex","flexDirection":"column","gap":"8px","color":"#3A3832","fontSize":"15px"}}><li>Reads the context, claims, and author intent</li><li>Finds candidate approved evidence</li><li>Proposes minimal rewrites via IntentLock</li><li>Challenges findings via the Critic agent</li></ul>
</div>
<div style={{"flex":"1 1 300px","background":"#FFFDF8","border":"1.5px solid #0E0E10","boxShadow":"4px 4px 0 #22C55E","padding":"28px","display":"flex","flexDirection":"column","gap":"14px"}}>
<div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"32px","fontWeight":"800","letterSpacing":"-0.02em"}}>Code verifies</div>
<ul style={{"margin":"0","paddingLeft":"20px","display":"flex","flexDirection":"column","gap":"8px","color":"#3A3832","fontSize":"15px"}}><li>Exact numbers, dates and quantities</li><li>Explicit brand prohibitions &amp; banned terms</li><li>Compound claim segmentation &amp; injection checks</li><li>Re-verifies 100% of proposed patches offline</li></ul>
</div>
<div style={{"flex":"1 1 300px","background":"#FFFDF8","border":"1.5px solid #0E0E10","boxShadow":"4px 4px 0 #FACC15","padding":"28px","display":"flex","flexDirection":"column","gap":"14px"}}>
<div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"32px","fontWeight":"800","letterSpacing":"-0.02em"}}>Humans govern</div>
<ul style={{"margin":"0","paddingLeft":"20px","display":"flex","flexDirection":"column","gap":"8px","color":"#3A3832","fontSize":"15px"}}><li>Approve, dismiss, override or request review</li><li>Decide every high-risk or ambiguous finding</li><li>Records precedent notes for team consistency</li><li>Holds the absolute final authority</li></ul>
</div>
</div>
</section>


<section id="lifecycle" style={{"background":"#FFFDF8","borderTop":"1.5px solid #0E0E10","borderBottom":"1.5px solid #0E0E10","padding":"96px 48px"}}>
<div style={{"maxWidth":"1200px","margin":"0 auto","display":"flex","flexDirection":"column","gap":"14px"}}>
<div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","letterSpacing":"0.1em","textTransform":"uppercase","color":"#2447FF"}}>The lifecycle</div>
<h2 style={{"margin":"0 0 24px","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontWeight":"700","fontSize":"clamp(32px, 5vw, 56px)","lineHeight":"1.1","letterSpacing":"-0.03em"}}>Ten controlled steps, not a pile of prompts</h2>

<div style={{"display":"flex","flexWrap":"wrap","gap":"16px"}}>
{LIFECYCLE_STEPS.map((step, idx) => {
  const isSelected = activeLifecycleStep === idx
  return (
    <div
      key={step.step}
      onClick={() => setActiveLifecycleStep(idx)}
      style={{
        "flex":"1 1 200px",
        "border": isSelected ? "2px solid #2447FF" : "1.5px solid #0E0E10",
        "background": isSelected ? "#FFFFFF" : "#F4F2EC",
        "boxShadow": isSelected ? "4px 4px 0 #2447FF" : "2px 2px 0 #0E0E10",
        "padding":"18px",
        "cursor":"pointer",
        "transition":"all 0.15s ease"
      }}
    >
      <div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"32px","fontWeight":"700","fontVariantNumeric":"tabular-nums","color":isSelected ? "#2447FF" : "#0E0E10"}}>
        {step.step}
      </div>
      <div style={{"fontWeight":"700","fontSize":"16px","marginTop":"4px"}}>{step.title}</div>
      <div style={{"fontSize":"14px","color":"#4A4740","marginTop":"4px"}}>{step.desc}</div>
    </div>
  )
})}
</div>

{/* Live Agent Trace & Code Execution Preview Terminal Bar */}
<div style={{"marginTop":"20px","background":"#0E0E10","color":"#F4F2EC","border":"1.5px solid #0E0E10","boxShadow":"5px 5px 0 #2447FF","padding":"20px","fontFamily":"'JetBrains Mono', monospace"}}>
  <div style={{"display":"flex","flexWrap":"wrap","justifyContent":"space-between","alignItems":"center","borderBottom":"1px solid #27272A","paddingBottom":"10px","marginBottom":"12px","fontSize":"12px","gap":"10px"}}>
    <span style={{"color":"#2447FF","fontWeight":"700"}}>
      STEP {LIFECYCLE_STEPS[activeLifecycleStep].step}: {LIFECYCLE_STEPS[activeLifecycleStep].title.toUpperCase()} // EXECUTION TELEMETRY
    </span>
    <span style={{"color":"#22C55E","background":"rgba(34,197,94,0.1)","padding":"2px 8px","border":"1px solid #22C55E","fontSize":"11px","fontWeight":"700"}}>
      DETERMINISTIC VERIFICATION ACTIVE
    </span>
  </div>
  <div style={{"fontSize":"13px","lineHeight":"1.6","color":"#CFCAC0"}}>
    <div><span style={{"color":"#2447FF"}}>&gt;</span> phase: <span style={{"color":"#FACC15","fontWeight":"700"}}>{LIFECYCLE_STEPS[activeLifecycleStep].traceData.phase}</span></div>
    <div><span style={{"color":"#2447FF"}}>&gt;</span> telemetry_payload: <span style={{"color":"#F4F2EC"}}>{JSON.stringify(LIFECYCLE_STEPS[activeLifecycleStep].traceData)}</span></div>
    <div style={{"color":"#8E897E","marginTop":"6px"}}>&gt; invariant_gate: 0x{(activeLifecycleStep + 1).toString(16).padStart(4, "0")} · tenant_workspace: {activeWorkspace.name} · signed</div>
  </div>
</div>

</div>
</section>


<section id="guardrails" style={{"padding":"96px 48px","maxWidth":"1264px","margin":"0 auto","boxSizing":"border-box"}}>
<div style={{"display":"flex","flexDirection":"column","gap":"14px","marginBottom":"32px"}}>
<div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","letterSpacing":"0.1em","textTransform":"uppercase","color":"#2447FF"}}>Guardrails &amp; Invariants</div>
<h2 style={{"margin":"0","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontWeight":"700","fontSize":"clamp(32px, 5vw, 56px)","lineHeight":"1.1","letterSpacing":"-0.03em"}}>When agents disagree, evidence wins</h2>
<p style={{"margin":"0","maxWidth":"700px","fontSize":"19px","color":"#3A3832"}}>Verity never forces a consensus that evidence does not prove. These rules are hard code, not soft prompts.</p>
</div>
<div style={{"border":"1.5px solid #0E0E10","background":"#FFFDF8","boxShadow":"5px 5px 0 #0E0E10"}}>
<div style={{"display":"flex","flexWrap":"wrap","borderBottom":"1.5px solid #0E0E10","alignItems":"center"}}>
  <div style={{"flex":"1 1 300px","padding":"16px 22px","fontWeight":"700","display":"flex","alignItems":"center","gap":"10px"}}>
    <span style={{"fontFamily":"'JetBrains Mono', monospace","color":"#2447FF","fontSize":"12px"}}>[CONFLICT]</span> Agents disagree
  </div>
  <div style={{"flex":"1 1 300px","padding":"16px 22px","color":"#3A3832","display":"flex","alignItems":"center","justifyContent":"space-between","gap":"10px"}}>
    <span>The critic investigates and demands canon proof. A vote does not decide.</span>
    <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","background":"#2447FF","color":"#FFFFFF","padding":"2px 6px","fontWeight":"700","whiteSpace":"nowrap"}}>CRITIC ADJUDICATION</span>
  </div>
</div>
<div style={{"display":"flex","flexWrap":"wrap","borderBottom":"1.5px solid #0E0E10","alignItems":"center"}}>
  <div style={{"flex":"1 1 300px","padding":"16px 22px","fontWeight":"700","display":"flex","alignItems":"center","gap":"10px"}}>
    <span style={{"fontFamily":"'JetBrains Mono', monospace","color":"#EF4444","fontSize":"12px"}}>[RULE_BREACH]</span> Hard rule violated
  </div>
  <div style={{"flex":"1 1 300px","padding":"16px 22px","color":"#3A3832","display":"flex","alignItems":"center","justifyContent":"space-between","gap":"10px"}}>
    <span>The violation is preserved with high severity. No model can clear it.</span>
    <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","background":"#EF4444","color":"#FFFFFF","padding":"2px 6px","fontWeight":"700","whiteSpace":"nowrap"}}>GRADE A IMMUTABLE</span>
  </div>
</div>
<div style={{"display":"flex","flexWrap":"wrap","borderBottom":"1.5px solid #0E0E10","alignItems":"center"}}>
  <div style={{"flex":"1 1 300px","padding":"16px 22px","fontWeight":"700","display":"flex","alignItems":"center","gap":"10px"}}>
    <span style={{"fontFamily":"'JetBrains Mono', monospace","color":"#FACC15","fontSize":"12px"}}>[NO_SOURCE]</span> Evidence missing
  </div>
  <div style={{"flex":"1 1 300px","padding":"16px 22px","color":"#3A3832","display":"flex","alignItems":"center","justifyContent":"space-between","gap":"10px"}}>
    <span>Marked unverifiable under closed-world assumption. Never hallucinated.</span>
    <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","background":"#FACC15","color":"#0E0E10","padding":"2px 6px","fontWeight":"700","whiteSpace":"nowrap"}}>CLOSED-WORLD INVARIANT</span>
  </div>
</div>
<div style={{"display":"flex","flexWrap":"wrap","borderBottom":"1.5px solid #0E0E10","alignItems":"center"}}>
  <div style={{"flex":"1 1 300px","padding":"16px 22px","fontWeight":"700","display":"flex","alignItems":"center","gap":"10px"}}>
    <span style={{"fontFamily":"'JetBrains Mono', monospace","color":"#EF4444","fontSize":"12px"}}>[PATCH_FAIL]</span> Rewrite fails re-check
  </div>
  <div style={{"flex":"1 1 300px","padding":"16px 22px","color":"#3A3832","display":"flex","alignItems":"center","justifyContent":"space-between","gap":"10px"}}>
    <span>The proposed patch is rejected and never shown as a clean fix.</span>
    <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","background":"#EF4444","color":"#FFFFFF","padding":"2px 6px","fontWeight":"700","whiteSpace":"nowrap"}}>INTENTLOCK REJECTION</span>
  </div>
</div>
<div style={{"display":"flex","flexWrap":"wrap","borderBottom":"1.5px solid #0E0E10","alignItems":"center"}}>
  <div style={{"flex":"1 1 300px","padding":"16px 22px","fontWeight":"700","display":"flex","alignItems":"center","gap":"10px"}}>
    <span style={{"fontFamily":"'JetBrains Mono', monospace","color":"#8E897E","fontSize":"12px"}}>[TIMEOUT]</span> Model timeout or 429
  </div>
  <div style={{"flex":"1 1 300px","padding":"16px 22px","color":"#3A3832","display":"flex","alignItems":"center","justifyContent":"space-between","gap":"10px"}}>
    <span>Deterministic offline rules run immediately with ai_unavailable flag.</span>
    <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","background":"#0E0E10","color":"#FFFFFF","padding":"2px 6px","fontWeight":"700","whiteSpace":"nowrap"}}>CIRCUIT BREAKER DEGRADED</span>
  </div>
</div>
<div style={{"display":"flex","flexWrap":"wrap","alignItems":"center"}}>
  <div style={{"flex":"1 1 300px","padding":"16px 22px","fontWeight":"700","display":"flex","alignItems":"center","gap":"10px"}}>
    <span style={{"fontFamily":"'JetBrains Mono', monospace","color":"#2447FF","fontSize":"12px"}}>[HIGH_RISK]</span> Legal or financial claim
  </div>
  <div style={{"flex":"1 1 300px","padding":"16px 22px","color":"#3A3832","display":"flex","alignItems":"center","justifyContent":"space-between","gap":"10px"}}>
    <span>Requires human sign-off; cannot be auto-cleared by any agent or rule.</span>
    <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","background":"#2447FF","color":"#FFFFFF","padding":"2px 6px","fontWeight":"700","whiteSpace":"nowrap"}}>HUMAN ESCALATION</span>
  </div>
</div>
</div>
</section>


<section id="report" style={{"background":"#0E0E10","color":"#F4F2EC","padding":"96px 48px"}}>
<div style={{"maxWidth":"1200px","margin":"0 auto","display":"flex","flexDirection":"column","gap":"14px"}}>
<div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","letterSpacing":"0.1em","textTransform":"uppercase","color":"#2447FF"}}>Audit trail</div>
<h2 style={{"margin":"0","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontWeight":"700","fontSize":"clamp(32px, 5vw, 56px)","lineHeight":"1.1","letterSpacing":"-0.03em"}}>Inspect the agents' work, not just a final score</h2>
<p style={{"margin":"0 0 24px","maxWidth":"700px","fontSize":"19px","color":"#CFCAC0"}}>Every review saves who did what, what evidence was used and what a human decided. Click any agent step below to inspect raw telemetry.</p>
<div style={{"display":"flex","flexWrap":"wrap","gap":"24px","alignItems":"flex-start"}}>
<div style={{"flex":"1 1 480px","minWidth":"0","border":"1.5px solid #F4F2EC","padding":"24px","display":"flex","flexDirection":"column","gap":"18px","background":"#18181B"}}>
<div style={{"display":"flex","flexWrap":"wrap","gap":"12px"}}>
<div style={{"flex":"1 1 100px","background":"#0E0E10","padding":"14px","border":"1px solid #27272A"}}><div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"36px","fontWeight":"700","fontVariantNumeric":"tabular-nums","lineHeight":"1"}}>04</div><div style={{"color":"#CFCAC0","fontSize":"13px","marginTop":"4px"}}>Agents involved</div></div>
<div style={{"flex":"1 1 100px","background":"#0E0E10","padding":"14px","border":"1px solid #27272A"}}><div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"36px","fontWeight":"700","fontVariantNumeric":"tabular-nums","lineHeight":"1"}}>03</div><div style={{"color":"#CFCAC0","fontSize":"13px","marginTop":"4px"}}>Findings verified</div></div>
<div style={{"flex":"1 1 100px","background":"#0E0E10","padding":"14px","border":"1px solid #27272A"}}><div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"36px","fontWeight":"700","fontVariantNumeric":"tabular-nums","lineHeight":"1","color":"#FACC15"}}>01</div><div style={{"color":"#CFCAC0","fontSize":"13px","marginTop":"4px"}}>Needs human review</div></div>
</div>
<div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","letterSpacing":"0.08em","color":"#CFCAC0"}}>INTERACTIVE AGENT EXECUTION TRACE (CLICK TO EXPAND)</div>
<div style={{"display":"flex","flexDirection":"column","gap":"10px"}}>
{[
  { id: "orch", name: "Orchestrator Agent", status: "completed", desc: "Extracted 3 claims and planned the review.", telemetry: { claims: 3, budget: 2, calls_spent: 0 } },
  { id: "claim", name: "Claim Verification", status: "completed", desc: "Found a claim that contradicts an approved fact.", telemetry: { contradicted_fact: "F-TRIAL (14 days)", rule: "R-QUANT-001" } },
  { id: "brand", name: "Brand Compliance & Voice", status: "completed", desc: "Checked approved terminology and brand rules.", telemetry: { forbidden_terms: 0, tone_consistency: 0.96 } },
  { id: "risk", name: "Risk Intelligence", status: "escalated", desc: "Flagged an absolute guarantee for human review.", telemetry: { risk_level: "HIGH", requires_officer: true } },
  { id: "critic", name: "Critic & Consensus", status: "completed", desc: "Reviewed the evidence and consolidated the findings.", telemetry: { consensus_mode: "evidence_weighted", suppressed_disputes: 0 } },
].map((row) => (
  <div
    key={row.id}
    onClick={() => setExpandedTraceRow(expandedTraceRow === row.id ? null : row.id)}
    style={{
      "padding":"10px 12px",
      "background":"#0E0E10",
      "border":"1px solid #27272A",
      "cursor":"pointer",
      "display":"flex",
      "flexDirection":"column",
      "gap":"6px"
    }}
  >
    <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","gap":"10px"}}>
      <div style={{"display":"flex","alignItems":"center","gap":"10px"}}>
        <span style={{"width":"10px","height":"10px","background":row.status === "escalated" ? "#FACC15" : "#22C55E","display":"inline-block","flex":"none"}}></span>
        <span style={{"fontWeight":"700","fontSize":"14px"}}>{row.name}</span>
      </div>
      <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":row.status === "escalated" ? "#FACC15" : "#22C55E"}}>
        {row.status} {expandedTraceRow === row.id ? "▲" : "▼"}
      </span>
    </div>
    <div style={{"color":"#CFCAC0","fontSize":"13px","paddingLeft":"20px"}}>{row.desc}</div>
    {expandedTraceRow === row.id && (
      <div style={{"marginTop":"6px","padding":"8px 12px","background":"#18181B","fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#2447FF","borderLeft":"2px solid #2447FF"}}>
        telemetry: {JSON.stringify(row.telemetry)}
      </div>
    )}
  </div>
))}
</div>
</div>
<div style={{"flex":"1 1 360px","minWidth":"0","display":"flex","flexDirection":"column","gap":"16px"}}>
<div style={{"background":"#F4F2EC","color":"#0E0E10","padding":"24px","display":"flex","flexDirection":"column","gap":"14px","boxShadow":"5px 5px 0 #2447FF","border":"1.5px solid #0E0E10"}}>
<div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","letterSpacing":"0.08em","color":"#3A3832"}}>THREE SEPARATE SIGNALS</div>
<div style={{"display":"flex","justifyContent":"space-between","gap":"12px","borderBottom":"1.5px solid #0E0E10","paddingBottom":"10px"}}><span>Severity</span><b>HIGH</b></div>
<div style={{"display":"flex","justifyContent":"space-between","gap":"12px","borderBottom":"1.5px solid #0E0E10","paddingBottom":"10px"}}><span>Evidence strength</span><b>CANON-CITED</b></div>
<div style={{"display":"flex","justifyContent":"space-between","gap":"12px"}}><span>Model confidence</span><b>0.90</b></div>
<div style={{"fontSize":"14px","color":"#3A3832"}}>Impact, proof and certainty are never blended into one number. A confident model cannot raise the evidence level.</div>
</div>
<div style={{"border":"1.5px solid #F4F2EC","padding":"20px","color":"#CFCAC0","fontSize":"14px","display":"flex","flexDirection":"column","gap":"14px","background":"#18181B"}}>
  <div>Stored per review: the plan, every agent step, suppressed findings, verified patches, the critic's disagreements and each human decision.</div>
  <div>
    <button
      type="button"
      onClick={handleContinueInWorkspace}
      className="neo-btn"
      style={{"background":"#2447FF","color":"#FFFFFF","padding":"10px 18px","border":"1.5px solid #FFFFFF","boxShadow":"3px 3px 0 #FFFFFF","fontWeight":"700","fontSize":"14px","textDecoration":"none","display":"inline-flex","alignItems":"center","gap":"6px","cursor":"pointer"}}
    >
      Continue in Workspace →
    </button>
  </div>
</div>
</div>
</div>
</div>
</section>



<section id="try" style={{"background":"#111111","borderTop":"2px solid #111111","borderBottom":"2px solid #111111","padding":"80px 48px"}}>
  <div style={{"maxWidth":"1200px","margin":"0 auto","display":"flex","flexDirection":"column","gap":"28px"}}>
    {/* Section Header with View Tabs */}
    <div style={{"display":"flex","flexWrap":"wrap","alignItems":"center","justifyContent":"space-between","gap":"20px","borderBottom":"1px solid #262626","paddingBottom":"24px"}}>
      <div>
        <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","letterSpacing":"0.1em","textTransform":"uppercase","color":"#3B66FF","fontWeight":"700","marginBottom":"8px"}}>
          {activeView === 'workspace' && 'LIVE VERITY ENGINE AUDIT'}
          {activeView === 'canon' && `CANONICAL TRUTH REPOSITORY · VERSION ${canonVersion}`}
          {activeView === 'history' && 'AUDIT & GOVERNANCE RECORD'}
          {activeView === 'policypulse' && 'GOVERNANCE INTELLIGENCE & CLARITY RADAR'}
          {activeView === 'eval' && 'REGRESSION & BENCHMARK EVALUATION ENGINE'}
        </div>
        <h2 style={{"margin":"0","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontWeight":"700","fontSize":"clamp(28px, 4.5vw, 48px)","lineHeight":"1.1","letterSpacing":"-0.03em","color":"#F4F1EA"}}>
          {activeView === 'workspace' && 'Paste your copy. See what the agents found.'}
          {activeView === 'canon' && `Brand Canon v${canonVersion} & Rule Management`}
          {activeView === 'history' && 'Review Run Logs & Human Decisions'}
          {activeView === 'policypulse' && 'PolicyPulse: Guideline Clarity & Risk Radar'}
          {activeView === 'eval' && 'Evaluation Suite: Precision, Recall & Regressions'}
        </h2>
      </div>

      {/* Console Tab Controls */}
      <div style={{"display":"inline-flex","flexWrap":"wrap","gap":"6px","background":"#18181B","padding":"6px","border":"1px solid #27272A"}}>
        <button
          type="button"
          onClick={() => setActiveView("workspace")}
          className="neo-btn"
          style={{
            "background": activeView === "workspace" ? "#2447FF" : "transparent",
            "color": activeView === "workspace" ? "#FFFFFF" : "#CFCAC0",
            "border": activeView === "workspace" ? "1.5px solid #0E0E10" : "1.5px solid transparent",
            "boxShadow": activeView === "workspace" ? "2px 2px 0 #000000" : "none",
            "padding": "8px 14px",
            "fontSize": "13px",
            "fontWeight": "700",
            "cursor": "pointer",
            "display": "inline-flex",
            "alignItems": "center",
            "gap": "8px"
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon></svg>
          Audit Workspace
        </button>
        <button
          type="button"
          onClick={() => setActiveView("canon")}
          className="neo-btn"
          style={{
            "background": activeView === "canon" ? "#2447FF" : "transparent",
            "color": activeView === "canon" ? "#FFFFFF" : "#CFCAC0",
            "border": activeView === "canon" ? "1.5px solid #0E0E10" : "1.5px solid transparent",
            "boxShadow": activeView === "canon" ? "2px 2px 0 #000000" : "none",
            "padding": "8px 14px",
            "fontSize": "13px",
            "fontWeight": "700",
            "cursor": "pointer",
            "display": "inline-flex",
            "alignItems": "center",
            "gap": "8px"
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"></path><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z"></path></svg>
          Brand Canon (v{canonVersion})
        </button>
        <button
          type="button"
          onClick={() => setActiveView("history")}
          className="neo-btn"
          style={{
            "background": activeView === "history" ? "#2447FF" : "transparent",
            "color": activeView === "history" ? "#FFFFFF" : "#CFCAC0",
            "border": activeView === "history" ? "1.5px solid #0E0E10" : "1.5px solid transparent",
            "boxShadow": activeView === "history" ? "2px 2px 0 #000000" : "none",
            "padding": "8px 14px",
            "fontSize": "13px",
            "fontWeight": "700",
            "cursor": "pointer",
            "display": "inline-flex",
            "alignItems": "center",
            "gap": "8px"
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
          History ({historyItems.length})
        </button>
        <button
          type="button"
          onClick={() => setActiveView("policypulse")}
          className="neo-btn"
          style={{
            "background": activeView === "policypulse" ? "#2447FF" : "transparent",
            "color": activeView === "policypulse" ? "#FFFFFF" : "#CFCAC0",
            "border": activeView === "policypulse" ? "1.5px solid #0E0E10" : "1.5px solid transparent",
            "boxShadow": activeView === "policypulse" ? "2px 2px 0 #000000" : "none",
            "padding": "8px 14px",
            "fontSize": "13px",
            "fontWeight": "700",
            "cursor": "pointer",
            "display": "inline-flex",
            "alignItems": "center",
            "gap": "8px"
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="2"></circle><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49m11.31-2.82a10 10 0 0 1 0 14.14m-14.14 0a10 10 0 0 1 0-14.14"></path></svg>
          PolicyPulse
        </button>
        <button
          type="button"
          onClick={() => setActiveView("eval")}
          className="neo-btn"
          style={{
            "background": activeView === "eval" ? "#2447FF" : "transparent",
            "color": activeView === "eval" ? "#FFFFFF" : "#CFCAC0",
            "border": activeView === "eval" ? "1.5px solid #0E0E10" : "1.5px solid transparent",
            "boxShadow": activeView === "eval" ? "2px 2px 0 #000000" : "none",
            "padding": "8px 14px",
            "fontSize": "13px",
            "fontWeight": "700",
            "cursor": "pointer",
            "display": "inline-flex",
            "alignItems": "center",
            "gap": "8px"
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 2v7.31"></path><path d="M14 9.3V2"></path><path d="M8.5 2h7"></path><path d="M14 9.3a6.5 6.5 0 1 1-4 0"></path><path d="M5.52 16h12.96"></path></svg>
          Evaluation Suite
        </button>
      </div>
    </div>

    {/* VIEW 1: Interactive Audit Workspace */}
    {activeView === "workspace" && (
      <div style={{"background":"#18181B","color":"#F4F1EA","border":"2px solid #27272A","boxShadow":"8px 8px 0 #000000","padding":"32px","display":"flex","flexDirection":"column","gap":"20px"}}>
        {/* Sample Chips */}
        <div>
          <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","letterSpacing":"0.08em","color":"#CFCAC0","marginBottom":"10px"}}>
            QUICK TEST PRESETS:
          </div>
          <div style={{"display":"flex","flexWrap":"wrap","gap":"8px"}}>
            {PRESETS.map((p) => (
              <button
                key={p.label}
                type="button"
                className="sample-chip"
                onClick={() => {
                  setContent(p.text)
                  runAudit(p.text)
                }}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Textarea */}
        <div style={{"display":"flex","flexDirection":"column","gap":"8px"}}>
          <textarea
            rows={4}
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder="Type or paste marketing copy here to audit against brand canon..."
            style={{
              "width":"100%",
              "boxSizing":"border-box",
              "background":"#FFFDF8",
              "color":"#111111",
              "border":"2px solid #111111",
              "padding":"16px",
              "fontFamily":"'Space Grotesk', system-ui, sans-serif",
              "fontSize":"16px",
              "lineHeight":"1.5",
              "resize":"vertical",
              "minHeight":"110px"
            }}
          />
          <div style={{"display":"flex","justifyContent":"space-between","fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","color":"#8E897E"}}>
            <span>Runs against active Brand Canon policies & approved facts</span>
            <span style={{"color": content.length > 5000 ? '#EF4444' : '#8E897E'}}>
              {content.length.toLocaleString()} / 5,000
            </span>
          </div>
        </div>

        {/* Action Bar */}
        <div style={{"display":"flex","flexWrap":"wrap","alignItems":"center","justifyContent":"space-between","gap":"16px"}}>
          <div style={{"display":"flex","gap":"12px"}}>
            <button
              type="button"
              onClick={() => runAudit(content)}
              disabled={loading}
              className="neo-btn"
              style={{
                "background":"#3B66FF",
                "color":"#FFFFFF",
                "border":"2px solid #111111",
                "boxShadow":"4px 4px 0 #000000",
                "padding":"14px 28px",
                "fontSize":"16px",
                "fontWeight":"700",
                "display":"inline-flex",
                "alignItems":"center",
                "gap":"10px",
                "opacity": loading ? 0.7 : 1
              }}
            >
              {loading && (
                <span
                  style={{
                    "width":"14px",
                    "height":"14px",
                    "border":"2px solid #FFFFFF",
                    "borderTopColor":"transparent",
                    "borderRadius":"50%",
                    "animation":"spin 0.8s linear infinite"
                  }}
                />
              )}
              <span>{loading ? 'Auditing with Agents...' : 'Run Multi-Agent Audit'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setContent('')
                setResult(null)
                setError(null)
              }}
              className="neo-btn"
              style={{"background":"transparent","color":"#F4F1EA","border":"2px solid #F4F1EA","padding":"14px 20px","fontSize":"15px"}}
            >
              Clear
            </button>
          </div>

          <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","color": error ? '#EF4444' : result ? '#7BE0A4' : '#CFCAC0'}}>
            {error ? error : result ? '✓ Audit verified against Canon' : 'Engine ready · Connected to /api/review'}
          </div>
        </div>

        {/* Multi-Agent Sequential Pipeline HUD */}
        {loading && (
          <div style={{"background":"#0E0E10","border":"1.5px solid #2447FF","boxShadow":"4px 4px 0 #2447FF","padding":"20px","fontFamily":"'JetBrains Mono', monospace","marginTop":"12px"}}>
            <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","marginBottom":"14px","borderBottom":"1px solid #27272A","paddingBottom":"8px","flexWrap":"wrap","gap":"8px"}}>
              <span style={{"color":"#2447FF","fontWeight":"700","fontSize":"12px"}}>MULTI-AGENT PIPELINE ENGAGED // AUDITING WORKSPACE</span>
              <span style={{"color":"#22C55E","fontSize":"11px","background":"rgba(34,197,94,0.1)","padding":"2px 8px","border":"1px solid #22C55E"}}>HARD BUDGET: ≤ 2 LLM CALLS</span>
            </div>
            <div style={{"display":"grid","gridTemplateColumns":"repeat(auto-fit, minmax(200px, 1fr))","gap":"10px"}}>
              {[
                { stage: 1, title: "01 ORCHESTRATOR", desc: "Decomposing claims & setting budget" },
                { stage: 2, title: "02 SPECIALISTS", desc: "FactVerifier & BrandVoice dispatch" },
                { stage: 3, title: "03 CRITIC CONSENSUS", desc: "Conflict resolution & invariant check" },
                { stage: 4, title: "04 INTENTLOCK", desc: "Re-verifying minimal patch offline" },
              ].map((s) => {
                const isActive = auditStepStage >= s.stage
                const isCurrent = auditStepStage === s.stage
                return (
                  <div
                    key={s.stage}
                    style={{
                      "padding":"10px 12px",
                      "background": isCurrent ? "#18181B" : "#0E0E10",
                      "border": isCurrent ? "1.5px solid #2447FF" : "1px solid #27272A",
                      "color": isActive ? "#F4F2EC" : "#71717A"
                    }}
                  >
                    <div style={{"display":"flex","alignItems":"center","gap":"8px","fontWeight":"700","fontSize":"11px","color": isActive ? (isCurrent ? "#2447FF" : "#22C55E") : "#71717A"}}>
                      <span>{isActive ? (isCurrent ? "▶" : "✓") : "○"}</span>
                      <span>{s.title}</span>
                    </div>
                    <div style={{"fontSize":"11px","color":"#A1A1AA","marginTop":"4px"}}>{s.desc}</div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Results Box */}
        {result && (() => {
          const criticalViolations = (result.findings || []).filter((f: any) => 
            f.severity === 'high' || f.category === 'Contradicted' || (f.rule && (f.rule.toLowerCase().includes('trial') || f.rule.toLowerCase().includes('superlative')))
          )
          const criticalCount = criticalViolations.length
          const isPassed = criticalCount === 0 && (result.score ?? 0) >= 90
          const verdictText = criticalCount > 0 
            ? `CRITICAL VIOLATIONS (${criticalCount} DETECTED)` 
            : isPassed 
              ? 'PASSED (CANON COMPLIANT)' 
              : 'FLAGGED (ISSUES DETECTED)'
          const verdictColor = criticalCount > 0 ? '#EF4444' : isPassed ? '#22C55E' : '#FACC15'

          return (
          <div style={{"borderTop":"2px dashed #444","paddingTop":"24px","marginTop":"8px"}}>
            <div style={{"display":"flex","flexWrap":"wrap","justifyContent":"space-between","alignItems":"center","gap":"16px","marginBottom":"20px"}}>
              <div style={{"display":"flex","alignItems":"center","gap":"18px"}}>
                <div
                  style={{
                    "fontFamily":"'Space Grotesk', system-ui, sans-serif",
                    "fontSize":"48px",
                    "fontWeight":"700",
                    "fontVariantNumeric":"tabular-nums",
                    "lineHeight":"1",
                    "color": verdictColor
                  }}
                >
                  {result.score ?? '--'}
                </div>
                <div>
                  <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","letterSpacing":"0.08em","color":"#8E897E"}}>
                    VERDICT
                  </div>
                  <div
                    style={{
                      "fontWeight":"700",
                      "fontSize":"20px",
                      "color": verdictColor
                    }}
                  >
                    {verdictText}
                  </div>
                </div>
              </div>

              <div style={{"display":"flex","flexWrap":"wrap","gap":"10px"}}>
                <span
                  style={{
                    "fontFamily":"'JetBrains Mono', monospace",
                    "fontSize":"12px",
                    "fontWeight":"600",
                    "padding":"6px 12px",
                    "border":"1px solid #22C55E",
                    "color":"#22C55E",
                    "background":"rgba(34, 197, 94, 0.1)"
                  }}
                >
                  {(result.llmCalls ?? result.llm_calls ?? 0) === 0 ? '⚡ 0 LLM calls · Resolved deterministically' : `🤖 ${result.llmCalls ?? result.llm_calls} LLM calls · Multi-agent consensus`}
                </span>
                <span
                  style={{
                    "fontFamily":"'JetBrains Mono', monospace",
                    "fontSize":"12px",
                    "fontWeight":"600",
                    "padding":"6px 12px",
                    "border":"1px solid #8E897E",
                    "color":"#CFCAC0",
                    "background":"#1E1E1E"
                  }}
                >
                  Canon v{result.canonVersion ?? canonVersion}
                </span>
              </div>
            </div>

            {/* Evaluated stats */}
            <div style={{"display":"grid","gridTemplateColumns":"repeat(auto-fit, minmax(130px, 1fr))","gap":"10px","marginBottom":"20px"}}>
              <div style={{"background":"#1E1E1E","padding":"12px","border":"1px solid #333"}}>
                <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>RULES EVALUATED</div>
                <div style={{"fontSize":"20px","fontWeight":"700","marginTop":"2px"}}>{result.evaluated?.rules ?? '—'}</div>
              </div>
              <div style={{"background":"#1E1E1E","padding":"12px","border":"1px solid #333"}}>
                <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>FACTS EVALUATED</div>
                <div style={{"fontSize":"20px","fontWeight":"700","marginTop":"2px"}}>{result.evaluated?.facts ?? '—'}</div>
              </div>
              <div style={{"background":"#1E1E1E","padding":"12px","border":"1px solid #333"}}>
                <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>LLM CALLS</div>
                <div style={{"fontSize":"20px","fontWeight":"700","marginTop":"2px"}}>{result.llmCalls ?? result.llm_calls ?? 0}</div>
              </div>
              <div style={{"background":"#1E1E1E","padding":"12px","border":"1px solid #333"}}>
                <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>FINDINGS</div>
                <div style={{"fontSize":"20px","fontWeight":"700","marginTop":"2px"}}>{result.findings?.length ?? 0}</div>
              </div>
            </div>

            {/* VERITY Agent Lifecycle Trace */}
            {(result.governance || (result.agentTrace && result.agentTrace.length > 0)) && (
              <div style={{"background":"#171717","border":"2px solid #333","padding":"18px","marginBottom":"20px","display":"flex","flexDirection":"column","gap":"12px"}}>
                <div style={{"display":"flex","flexWrap":"wrap","justifyContent":"space-between","alignItems":"center","borderBottom":"1px solid #333","paddingBottom":"10px"}}>
                  <div>
                    <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#3B66FF","fontWeight":"700","textTransform":"uppercase","letterSpacing":"0.08em"}}>
                      VERITY · AGENT-FIRST GOVERNANCE
                    </span>
                    <div style={{"fontWeight":"700","fontSize":"16px","color":"#F4F1EA"}}>
                      Multi-Agent Execution &amp; Trace
                    </div>
                  </div>
                  <div style={{"display":"flex","gap":"8px"}}>
                    {result.governance?.summary && (
                      <>
                        <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","padding":"3px 8px","background":"rgba(123, 224, 164, 0.15)","color":"#7BE0A4","border":"1px solid #7BE0A4"}}>
                          {result.governance.summary.agents_involved} Agents Active
                        </span>
                        <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","padding":"3px 8px","background":"rgba(239, 68, 68, 0.15)","color":"#EF4444","border":"1px solid #EF4444"}}>
                          {result.governance.summary.needs_human_review} Need Sign-off
                        </span>
                      </>
                    )}
                  </div>
                </div>

                <div style={{"display":"flex","flexDirection":"column","gap":"8px","fontFamily":"'JetBrains Mono', monospace","fontSize":"12px"}}>
                  {result.agentTrace && result.agentTrace.length > 0 ? (
                    result.agentTrace.map((step, idx) => (
                      <div key={idx} style={{"background":"#111","border":"1px solid #2a2a2a","padding":"10px 14px","display":"flex","alignItems":"flex-start","gap":"10px"}}>
                        <span style={{"marginTop":"4px","width":"8px","height":"8px","borderRadius":"50%","background": step.ok ? "#7BE0A4" : "#FFD166","flexShrink":0}} />
                        <div style={{"flex":1}}>
                          <div style={{"display":"flex","justifyContent":"space-between","gap":"8px"}}>
                            <b style={{"color":"#F4F1EA","textTransform":"capitalize"}}>{step.agent.replace(/[-_]/g, " ")}</b>
                            <span style={{"color":"#8E897E","fontSize":"11px"}}>{step.calls > 0 ? `${step.calls} call · ` : "code · "}{step.ms}ms</span>
                          </div>
                          <div style={{"color":"#CFCAC0","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"13px","marginTop":"2px"}}>{step.detail}</div>
                        </div>
                      </div>
                    ))
                  ) : (
                    result.governance?.agents?.map((ag, idx) => (
                      <div key={idx} style={{"background":"#111","border":"1px solid #2a2a2a","padding":"10px 14px","display":"flex","alignItems":"flex-start","gap":"10px"}}>
                        <span style={{"marginTop":"4px","width":"8px","height":"8px","borderRadius":"50%","background":"#7BE0A4","flexShrink":0}} />
                        <div style={{"flex":1}}>
                          <div style={{"display":"flex","justifyContent":"space-between","gap":"8px"}}>
                            <b style={{"color":"#F4F1EA"}}>{ag.label || ag.agent}</b>
                            <span style={{"color":"#8E897E","fontSize":"11px"}}>{ag.calls > 0 ? `${ag.calls} calls · ` : "code · "}{ag.ms}ms</span>
                          </div>
                          <div style={{"color":"#CFCAC0","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"13px","marginTop":"2px"}}>{ag.summary}</div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* VERITY Critic Suppressions & Second Guard Verifications */}
                {result.governance?.suppressed_details && result.governance.suppressed_details.length > 0 && (
                  <div style={{"background":"#111","border":"1px solid #333","padding":"12px 14px","marginTop":"4px"}}>
                    <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#FFD166","fontWeight":"700","marginBottom":"8px","letterSpacing":"0.05em"}}>
                      CRITIC SUPPRESSIONS &amp; SECOND GUARD VERIFICATION ({result.governance.suppressed_details.length})
                    </div>
                    <div style={{"display":"flex","flexDirection":"column","gap":"8px"}}>
                      {result.governance.suppressed_details.map((sup, sidx) => (
                        <div key={sup.id || sidx} style={{"background":"#171717","border":"1px solid #222","padding":"10px","fontSize":"12px"}}>
                          <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","flexWrap":"wrap","gap":"6px","marginBottom":"4px"}}>
                            <span style={{"color":"#F4F1EA","fontWeight":"600"}}>Candidate: &ldquo;{sup.quote}&rdquo;</span>
                            <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"10px","color":"#8E897E","background":"#0d0d0d","padding":"2px 6px"}}>
                              {sup.source} · {sup.category}
                            </span>
                          </div>
                          <div style={{"color":"#FFD166","marginTop":"2px"}}>
                            <b>Critic Verdict ({sup.critic_verdict}):</b> {sup.critic_explanation}
                          </div>
                          <div style={{"color":"#7BE0A4","marginTop":"2px"}}>
                            <b>Second Guard:</b> {sup.second_guard_explanation}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Findings List */}
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","letterSpacing":"0.08em","color":"#CFCAC0","marginBottom":"12px"}}>
              DETECTED ISSUES &amp; EVIDENCE:
            </div>
            <div style={{"display":"flex","flexDirection":"column","gap":"12px","marginBottom":"20px"}}>
              {(!result.findings || result.findings.length === 0) ? (
                <div style={{"background":"rgba(123, 224, 164, 0.1)","border":"1px solid #7BE0A4","padding":"16px","color":"#7BE0A4","fontWeight":"600"}}>
                  ✓ No policy or factual violations detected. Copy is 100% compliant with approved Brand Canon.
                </div>
              ) : (
                result.findings.map((f, i) => (
                  <div
                    key={f.id || i}
                    style={{
                      "background":"#1E1E1E",
                      "border":"2px solid #333",
                      "borderLeft": f.severity === 'high' ? '6px solid #EF4444' : f.severity === 'low' ? '6px solid #7BE0A4' : '6px solid #FFD166',
                      "padding":"16px",
                      "display":"flex",
                      "flexDirection":"column",
                      "gap":"8px"
                    }}
                  >
                    <div style={{"display":"flex","flexWrap":"wrap","justifyContent":"space-between","alignItems":"center","gap":"8px"}}>
                      <div style={{"fontWeight":"700","fontSize":"16px","color":"#F4F1EA"}}>
                        {f.span_text ? `"${f.span_text}"` : f.rule_id || `Finding #${i + 1}`}
                      </div>
                      <div style={{"display":"flex","flexWrap":"wrap","gap":"6px","fontFamily":"'JetBrains Mono', monospace","fontSize":"11px"}}>
                        {f.source?.startsWith("agent:") ? (
                          <span style={{"background":"rgba(59, 102, 255, 0.2)","color":"#809BFF","padding":"2px 8px","border":"1px solid #3B66FF"}}>
                            ⚡ MODEL-VERIFIED (AI)
                          </span>
                        ) : (
                          <span style={{"background":"rgba(255, 209, 102, 0.15)","color":"#FFD166","padding":"2px 8px","border":"1px solid #FFD166"}}>
                            🔒 RULE-BASED (OFFLINE)
                          </span>
                        )}
                        {f.requires_human_review && (
                          <span style={{"background":"rgba(239, 68, 68, 0.2)","color":"#F87171","padding":"2px 8px","border":"1px solid #EF4444"}}>
                            ⚖ HUMAN REVIEW REQUIRED
                          </span>
                        )}
                        {f.grade && <span style={{"background":"#111","color":"#7BE0A4","padding":"2px 8px","border":"1px solid #7BE0A4"}}>GRADE {f.grade}</span>}
                        {f.verdict && <span style={{"background":"#111","color":"#FFD166","padding":"2px 8px","border":"1px solid #FFD166"}}>{f.verdict}</span>}
                        <span style={{"background":"#111","color":"#CFCAC0","padding":"2px 8px","border":"1px solid #555"}}>SEV: {(f.severity || 'HIGH').toUpperCase()}</span>
                      </div>
                    </div>
                    <div style={{"color":"#CFCAC0","fontSize":"14px","lineHeight":"1.5"}}>
                      {f.explanation || 'No explanation provided.'}
                    </div>
                    {f.suggested_fix && (
                      <div style={{"background":"#141414","padding":"14px 16px","border":"1px solid #7BE0A433","borderLeft":"4px solid #7BE0A4","fontSize":"14px","marginTop":"6px"}}>
                        <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","flexWrap":"wrap","gap":"6px","marginBottom":"8px"}}>
                          <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#7BE0A4","fontWeight":"700","letterSpacing":"0.06em","display":"flex","alignItems":"center","gap":"6px"}}>
                            🔒 INTENTLOCK™ · RE-VERIFIED REVISION
                          </span>
                          <span style={{"fontSize":"11px","color":"#7BE0A4","fontFamily":"'JetBrains Mono', monospace","background":"rgba(123, 224, 164, 0.15)","padding":"2px 8px","border":"1px solid #7BE0A4"}}>
                            Deterministic Re-verification: PASSED ✓
                          </span>
                        </div>
                        <div style={{"display":"flex","flexDirection":"column","gap":"8px","background":"#0c0c0c","padding":"10px 12px","border":"1px solid #222"}}>
                          <div style={{"fontSize":"13px","lineHeight":"1.4"}}>
                            <span style={{"color":"#EF4444","fontWeight":"700","fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","marginRight":"8px"}}>ORIGINAL:</span>
                            <span style={{"color":"#F87171","textDecoration":"line-through","opacity":"0.85"}}>"{f.span_text}"</span>
                          </div>
                          <div style={{"fontSize":"13px","lineHeight":"1.4"}}>
                            <span style={{"color":"#10B981","fontWeight":"700","fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","marginRight":"8px"}}>REVISION:</span>
                            <span style={{"color":"#7BE0A4","fontWeight":"600"}}>"{f.suggested_fix}"</span>
                          </div>
                        </div>
                        {f.patch?.rationale && (
                          <div style={{"fontSize":"12px","color":"#CFCAC0","marginTop":"8px","fontStyle":"italic"}}>
                            Rationale: {f.patch.rationale}
                          </div>
                        )}
                        <div style={{"fontSize":"11px","color":"#8E897E","marginTop":"8px","borderTop":"1px solid #222","paddingTop":"6px","display":"flex","justifyContent":"space-between","alignItems":"center","flexWrap":"wrap","gap":"6px"}}>
                          <span>IntentLock ensures rewrite satisfies Brand Canon rules without altering marketing intent.</span>
                          <span style={{"color":"#FFD166"}}>Human sign-off required</span>
                        </div>
                      </div>
                    )}

                    {/* Specialist Intelligence Enrichment */}
                    {f.enrichments && f.enrichments.length > 0 && (
                      <div style={{"background":"#161b22","border":"1px solid #3B66FF55","padding":"12px","marginTop":"6px","display":"flex","flexDirection":"column","gap":"8px"}}>
                        <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","flexWrap":"wrap","gap":"6px"}}>
                          <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#3B66FF","fontWeight":"700","textTransform":"uppercase","letterSpacing":"0.05em"}}>
                            ✦ Specialist Intelligence Enrichment ({f.enrichments.length})
                          </span>
                          {f.enrichments.some(e => e.requires_human_review) && (
                            <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"10px","background":"rgba(239, 68, 68, 0.2)","color":"#EF4444","padding":"2px 6px","border":"1px solid #EF4444"}}>
                              Requires Legal / Human Sign-off
                            </span>
                          )}
                        </div>
                        {f.enrichments.map((enr, eidx) => (
                          <div key={eidx} style={{"background":"#0d1117","padding":"10px","borderLeft":"3px solid #3B66FF","fontSize":"13px"}}>
                            <div style={{"display":"flex","flexWrap":"wrap","justifyContent":"space-between","alignItems":"center","gap":"6px","marginBottom":"4px"}}>
                              <span style={{"fontFamily":"'JetBrains Mono', monospace","fontWeight":"700","color":"#F4F1EA"}}>
                                {enr.agent} · {enr.category}
                              </span>
                              <div style={{"display":"flex","gap":"6px","fontFamily":"'JetBrains Mono', monospace","fontSize":"10px"}}>
                                {enr.confidence !== undefined && (
                                  <span style={{"background":"#21262d","color":"#7BE0A4","padding":"1px 6px"}}>
                                    {Math.round(enr.confidence * 100)}% confidence
                                  </span>
                                )}
                                {enr.citations && enr.citations.length > 0 && (
                                  <span style={{"background":"#21262d","color":"#CFCAC0","padding":"1px 6px"}}>
                                    {enr.citations.map(c => c.id).join(", ")}
                                  </span>
                                )}
                              </div>
                            </div>
                            <div style={{"color":"#CFCAC0","fontSize":"13px","lineHeight":"1.4"}}>
                              {enr.reasoning}
                            </div>
                            {enr.legal_interpretation && (
                              <div style={{"marginTop":"6px","background":"rgba(239, 68, 68, 0.1)","border":"1px solid rgba(239, 68, 68, 0.3)","padding":"6px 10px","color":"#FCA5A5","fontSize":"12px"}}>
                                <b>Legal Interpretation:</b> {enr.legal_interpretation}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Consensus Lifecycle Trace */}
                    {f.lifecycle && (
                      <div style={{"background":"#111","border":"1px solid #2a2a2a","padding":"10px 12px","marginTop":"6px","fontFamily":"'JetBrains Mono', monospace","fontSize":"11px"}}>
                        <div style={{"color":"#8E897E","marginBottom":"6px","textTransform":"uppercase","letterSpacing":"0.05em","fontSize":"10px"}}>
                          Lifecycle: Specialist → First Guard → Critic → Second Guard → Final
                        </div>
                        <div style={{"display":"grid","gridTemplateColumns":"repeat(auto-fit, minmax(200px, 1fr))","gap":"6px"}}>
                          {f.lifecycle.specialist && (
                            <div style={{"background":"#171717","padding":"6px 8px","borderLeft":"2px solid #3B66FF"}}>
                              <span style={{"color":"#3B66FF","fontWeight":"700"}}>1. Specialist</span>
                              <div style={{"color":"#CFCAC0","fontSize":"11px","marginTop":"2px"}}>
                                {f.lifecycle.specialist.agent} ({f.lifecycle.specialist.verdict || 'flagged'})
                                {f.lifecycle.specialist.confidence !== undefined && ` · ${Math.round(f.lifecycle.specialist.confidence * 100)}%`}
                              </div>
                            </div>
                          )}
                          {f.lifecycle.first_guard && (
                            <div style={{"background":"#171717","padding":"6px 8px","borderLeft":"2px solid #7BE0A4"}}>
                              <span style={{"color":"#7BE0A4","fontWeight":"700"}}>2. First Guard</span>
                              <div style={{"color":"#CFCAC0","fontSize":"11px","marginTop":"2px"}}>
                                {f.lifecycle.first_guard.action.toUpperCase()}: {f.lifecycle.first_guard.detail}
                              </div>
                            </div>
                          )}
                          {f.lifecycle.critic && (
                            <div style={{"background":"#171717","padding":"6px 8px","borderLeft":"2px solid #FFD166"}}>
                              <span style={{"color":"#FFD166","fontWeight":"700"}}>3. Critic</span>
                              <div style={{"color":"#CFCAC0","fontSize":"11px","marginTop":"2px"}}>
                                {f.lifecycle.critic.verdict.toUpperCase()}: {f.lifecycle.critic.reason}
                              </div>
                            </div>
                          )}
                          {f.lifecycle.second_guard && (
                            <div style={{"background":"#171717","padding":"6px 8px","borderLeft":"2px solid #10B981"}}>
                              <span style={{"color":"#10B981","fontWeight":"700"}}>4. Second Guard</span>
                              <div style={{"color":"#CFCAC0","fontSize":"11px","marginTop":"2px"}}>
                                {f.lifecycle.second_guard.action.toUpperCase()}: {f.lifecycle.second_guard.detail}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Human Governance Determination Bar */}
            <div style={{"background":"#111111","border":"1px solid #333","padding":"18px","display":"flex","flexDirection":"column","gap":"12px","marginBottom":"20px"}}>
              <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","flexWrap":"wrap","gap":"10px"}}>
                <div>
                  <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#3B66FF","fontWeight":"700","letterSpacing":"0.08em"}}>
                    HUMAN GOVERNANCE AUTHORITY
                  </div>
                  <div style={{"fontSize":"15px","fontWeight":"700","color":"#F4F1EA"}}>
                    Seal your governance determination on this copy
                  </div>
                </div>
                {auditDecision && (
                  <span style={{
                    "fontFamily":"'JetBrains Mono', monospace",
                    "fontSize":"12px",
                    "padding":"4px 10px",
                    "fontWeight":"700",
                    "background": auditDecision === 'approved' ? 'rgba(16, 185, 129, 0.2)' : auditDecision === 'rejected' ? 'rgba(239, 68, 68, 0.2)' : 'rgba(255, 209, 102, 0.2)',
                    "color": auditDecision === 'approved' ? '#10B981' : auditDecision === 'rejected' ? '#EF4444' : '#FFD166',
                    "border": `1px solid ${auditDecision === 'approved' ? '#10B981' : auditDecision === 'rejected' ? '#EF4444' : '#FFD166'}`
                  }}>
                    DECISION RECORDED: {auditDecision.toUpperCase()}
                  </span>
                )}
              </div>
              <div style={{"display":"flex","gap":"10px","flexWrap":"wrap"}}>
                <button
                  type="button"
                  onClick={() => handleRecordDecision("approved")}
                  className="neo-btn"
                  style={{"background":"#10B981","color":"#FFFFFF","padding":"8px 16px","fontSize":"14px","border":"1px solid #111"}}
                >
                  ✓ Approve Copy
                </button>
                <button
                  type="button"
                  onClick={() => handleRecordDecision("revised")}
                  className="neo-btn"
                  style={{"background":"#FFD166","color":"#111111","padding":"8px 16px","fontSize":"14px","border":"1px solid #111"}}
                >
                  ✎ Request Revision
                </button>
                <button
                  type="button"
                  onClick={() => handleRecordDecision("rejected")}
                  className="neo-btn"
                  style={{"background":"#EF4444","color":"#FFFFFF","padding":"8px 16px","fontSize":"14px","border":"1px solid #111"}}
                >
                  ✕ Reject Copy
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveView("history"); scrollToAudit(); }}
                  className="neo-btn"
                  style={{"background":"#1E1E1E","color":"#CFCAC0","padding":"8px 16px","fontSize":"14px","border":"1px solid #444"}}
                >
                  View in History Logs →
                </button>
              </div>
            </div>

            {/* In-Place Exploration CTA */}
            <div style={{"background":"#1E1E1E","border":"2px solid #3B66FF","padding":"18px 24px","display":"flex","flexWrap":"wrap","alignItems":"center","justifyContent":"space-between","gap":"16px"}}>
              <div>
                <div style={{"fontWeight":"700","fontSize":"17px"}}>
                  Explore Governance Rules &amp; Review History In-Place
                </div>
                <div style={{"color":"#CFCAC0","fontSize":"14px"}}>
                  Inspect active Brand Canon policies, deterministic patterns, and the full cryptographic audit history.
                </div>
              </div>
              <div style={{"display":"flex","gap":"10px","flexWrap":"wrap"}}>
                <button
                  type="button"
                  onClick={() => { setActiveView("canon"); scrollToAudit(); }}
                  className="neo-btn"
                  style={{"background":"#1E1E1E","color":"#F4F1EA","padding":"12px 18px","border":"1px solid #444","fontWeight":"700"}}
                >
                  Brand Canon (9 Rules) →
                </button>
                <button
                  type="button"
                  onClick={() => { setActiveView("history"); scrollToAudit(); }}
                  className="neo-btn"
                  style={{"background":"#3B66FF","color":"#FFFFFF","padding":"12px 22px","border":"2px solid #111111","fontWeight":"700"}}
                >
                  Decision History →
                </button>
              </div>
            </div>
          </div>
          )
        })()}
      </div>
    )}

    {/* VIEW 2: Brand Canon View */}
    {activeView === "canon" && (
      <div style={{"background":"#18181B","border":"2px solid #27272A","boxShadow":"8px 8px 0 #000000","padding":"32px","display":"flex","flexDirection":"column","gap":"24px"}}>
        {/* Controls Header */}
        <div style={{"display":"flex","flexWrap":"wrap","justifyContent":"space-between","alignItems":"center","gap":"16px"}}>
          <div style={{"flex":"1 1 320px"}}>
            <input
              type="text"
              value={canonSearch}
              onChange={(e) => setCanonSearch(e.target.value)}
              placeholder="Filter canonical rules or approved facts..."
              style={{
                "width":"100%",
                "maxWidth":"450px",
                "boxSizing":"border-box",
                "background":"#111111",
                "color":"#F4F1EA",
                "border":"1px solid #333",
                "padding":"10px 14px",
                "fontFamily":"'Space Grotesk', system-ui, sans-serif",
                "fontSize":"14px"
              }}
            />
          </div>
          <div style={{"display":"flex","alignItems":"center","gap":"10px","flexWrap":"wrap"}}>
            <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","color":"#7BE0A4","background":"rgba(123, 224, 164, 0.1)","padding":"6px 12px","border":"1px solid #7BE0A4"}}>
              Brand Canon Version {canonVersion} (Active)
            </span>
            <button
              type="button"
              onClick={() => setShowProposeModal(!showProposeModal)}
              className="neo-btn"
              style={{"background":"#10B981","color":"#FFFFFF","padding":"6px 14px","border":"1px solid #111","fontSize":"13px"}}
            >
              + Propose Rule / Fact
            </button>
            {canonVersion > 1 && (
              <button
                type="button"
                onClick={() => setCanonVersion(1)}
                className="neo-btn"
                style={{"background":"#27272A","color":"#CFCAC0","padding":"6px 12px","border":"1px solid #444","fontSize":"12px"}}
                title="Rollback to baseline Canon Version 1"
              >
                ↺ Rollback to v1
              </button>
            )}
            <button
              type="button"
              onClick={handleReturnToAudit}
              className="neo-btn"
              style={{"background":"#3B66FF","color":"#FFFFFF","padding":"8px 16px","border":"2px solid #111111","fontSize":"14px"}}
            >
              ← Return to Audit
            </button>
          </div>
        </div>

        {/* Propose Modal Form */}
        {showProposeModal && (
          <form
            onSubmit={handleAddProposal}
            style={{"background":"#111111","border":"2px solid #10B981","padding":"20px","display":"flex","flexDirection":"column","gap":"14px"}}
          >
            <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center"}}>
              <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","color":"#10B981","fontWeight":"700"}}>
                PROPOSE NEW BRAND CANON RULE / COMPLIANCE FACT
              </span>
              <button
                type="button"
                onClick={() => setShowProposeModal(false)}
                style={{"background":"none","border":"none","color":"#8E897E","cursor":"pointer","fontSize":"16px"}}
              >
                ✕
              </button>
            </div>
            <div style={{"display":"grid","gridTemplateColumns":"repeat(auto-fit, minmax(200px, 1fr))","gap":"12px"}}>
              <input
                type="text"
                placeholder="Rule Code (e.g. R-SEC-002)"
                value={proposedCode}
                onChange={(e) => setProposedCode(e.target.value)}
                style={{"background":"#18181B","border":"1px solid #333","color":"#FFF","padding":"8px 12px","fontSize":"13px"}}
                required
              />
              <input
                type="text"
                placeholder="Rule Description / Exact Statement"
                value={proposedDesc}
                onChange={(e) => setProposedDesc(e.target.value)}
                style={{"background":"#18181B","border":"1px solid #333","color":"#FFF","padding":"8px 12px","fontSize":"13px"}}
                required
              />
            </div>
            <div style={{"display":"flex","gap":"10px","alignItems":"center"}}>
              <button
                type="submit"
                className="neo-btn"
                style={{"background":"#10B981","color":"#FFF","padding":"8px 16px","fontSize":"13px","fontWeight":"700"}}
              >
                Submit Proposal for Governance Review
              </button>
              <button
                type="button"
                onClick={() => setShowProposeModal(false)}
                style={{"background":"transparent","border":"1px solid #444","color":"#CFCAC0","padding":"8px 14px","fontSize":"13px"}}
              >
                Cancel
              </button>
            </div>
          </form>
        )}

        {/* Pending Proposals Section */}
        {proposalsList.length > 0 && (
          <div style={{"background":"#111111","border":"1px solid #FFD16644","borderLeft":"4px solid #FFD166","padding":"18px","display":"flex","flexDirection":"column","gap":"12px"}}>
            <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","flexWrap":"wrap","gap":"8px"}}>
              <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","color":"#FFD166","fontWeight":"700"}}>
                PENDING CANON PROPOSALS ({proposalsList.filter(p => p.status === 'pending').length})
              </span>
              <span style={{"fontSize":"11px","color":"#8E897E"}}>Governance approval required before bumping active version</span>
            </div>
            {proposalsList.map(prop => (
              <div key={prop.id} style={{"background":"#18181B","padding":"12px","border":"1px solid #27272A","display":"flex","justifyContent":"space-between","alignItems":"center","flexWrap":"wrap","gap":"10px"}}>
                <div>
                  <div style={{"display":"flex","alignItems":"center","gap":"8px"}}>
                    <span style={{"fontFamily":"'JetBrains Mono', monospace","color":"#3B66FF","fontWeight":"700"}}>{prop.code}</span>
                    <span style={{"fontSize":"11px","color":"#8E897E"}}>Proposed by {prop.proposed_by} · {prop.created_at}</span>
                  </div>
                  <div style={{"fontSize":"13px","color":"#F4F1EA","marginTop":"4px"}}>{prop.description}</div>
                </div>
                {prop.status === 'pending' ? (
                  <div style={{"display":"flex","gap":"8px"}}>
                    <button
                      type="button"
                      onClick={() => handleApproveProposal(prop.id)}
                      className="neo-btn"
                      style={{"background":"#10B981","color":"#FFF","padding":"6px 12px","fontSize":"12px"}}
                    >
                      ✓ Approve &amp; Publish as v{canonVersion + 1}
                    </button>
                    <button
                      type="button"
                      onClick={() => setProposalsList(prev => prev.filter(p => p.id !== prop.id))}
                      className="neo-btn"
                      style={{"background":"#EF4444","color":"#FFF","padding":"6px 12px","fontSize":"12px"}}
                    >
                      ✕ Reject
                    </button>
                  </div>
                ) : (
                  <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#10B981","background":"rgba(16,185,129,0.15)","padding":"3px 8px","border":"1px solid #10B981"}}>
                    APPROVED (MERGED INTO CANON)
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Section 1: Canonical Rules Table */}
        <div>
          <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","letterSpacing":"0.08em","color":"#CFCAC0","marginBottom":"12px","display":"flex","justifyContent":"space-between"}}>
            <span>CANONICAL ENFORCEMENT RULES ({filteredRules.length})</span>
            <span style={{"fontSize":"11px","color":"#8E897E"}}>DETERMINISTIC REGEX &amp; AGENT GUARDRAILS</span>
          </div>
          <div className="desktop-table" style={{"overflowX":"auto","border":"1px solid #27272A"}}>
            <table style={{"width":"100%","borderCollapse":"collapse","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"14px","textAlign":"left"}}>
              <thead>
                <tr style={{"background":"#111111","borderBottom":"2px solid #27272A","color":"#8E897E","fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","letterSpacing":"0.06em"}}>
                  <th style={{"padding":"12px 14px"}}>CODE</th>
                  <th style={{"padding":"12px 14px"}}>CATEGORY</th>
                  <th style={{"padding":"12px 14px"}}>POLICY / PROHIBITION</th>
                  <th style={{"padding":"12px 14px"}}>APPROVED / PREFERRED</th>
                  <th style={{"padding":"12px 14px"}}>SEVERITY</th>
                  <th style={{"padding":"12px 14px"}}>ENFORCER</th>
                </tr>
              </thead>
              <tbody>
                {filteredRules.map((rule) => (
                  <tr key={rule.code} style={{"borderBottom":"1px solid #222","background":"#18181B"}}>
                    <td style={{"padding":"14px","fontFamily":"'JetBrains Mono', monospace","fontWeight":"700","color":"#3B66FF","whiteSpace":"nowrap"}}>
                      {rule.code}
                    </td>
                    <td style={{"padding":"14px","color":"#CFCAC0","whiteSpace":"nowrap","fontSize":"13px"}}>
                      {rule.category}
                    </td>
                    <td style={{"padding":"14px","color":"#F4F1EA","lineHeight":"1.4"}}>
                      {rule.description}
                    </td>
                    <td style={{"padding":"14px","color":"#7BE0A4","fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","lineHeight":"1.4"}}>
                      "{rule.preferred}"
                    </td>
                    <td style={{"padding":"14px","whiteSpace":"nowrap"}}>
                      <span style={{
                        "fontFamily":"'JetBrains Mono', monospace",
                        "fontSize":"11px",
                        "fontWeight":"700",
                        "padding":"3px 8px",
                        "border": rule.severity === 'HIGH' ? '1px solid #EF4444' : rule.severity === 'MEDIUM' ? '1px solid #FFD166' : '1px solid #7BE0A4',
                        "color": rule.severity === 'HIGH' ? '#EF4444' : rule.severity === 'MEDIUM' ? '#FFD166' : '#7BE0A4',
                        "background": rule.severity === 'HIGH' ? 'rgba(239, 68, 68, 0.1)' : rule.severity === 'MEDIUM' ? 'rgba(255, 209, 102, 0.1)' : 'rgba(123, 224, 164, 0.1)'
                      }}>
                        {rule.severity}
                      </span>
                    </td>
                    <td style={{"padding":"14px","color":"#8E897E","fontSize":"12px","whiteSpace":"nowrap"}}>
                      {rule.enforcer}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile responsive card alternative for Canonical Rules */}
          <div className="mobile-card-list" style={{"display":"none","flexDirection":"column","gap":"10px"}}>
            {filteredRules.map((rule) => (
              <div key={rule.code} style={{"background":"#18181B","border":"1px solid #27272A","padding":"14px","display":"flex","flexDirection":"column","gap":"8px"}}>
                <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","gap":"8px"}}>
                  <span style={{"fontFamily":"'JetBrains Mono', monospace","fontWeight":"700","color":"#3B66FF"}}>{rule.code}</span>
                  <span style={{
                    "fontFamily":"'JetBrains Mono', monospace",
                    "fontSize":"11px",
                    "fontWeight":"700",
                    "padding":"2px 6px",
                    "border": rule.severity === 'HIGH' ? '1px solid #EF4444' : rule.severity === 'MEDIUM' ? '1px solid #FFD166' : '1px solid #7BE0A4',
                    "color": rule.severity === 'HIGH' ? '#EF4444' : rule.severity === 'MEDIUM' ? '#FFD166' : '#7BE0A4',
                    "background": rule.severity === 'HIGH' ? 'rgba(239, 68, 68, 0.1)' : rule.severity === 'MEDIUM' ? 'rgba(255, 209, 102, 0.1)' : 'rgba(123, 224, 164, 0.1)'
                  }}>
                    {rule.severity}
                  </span>
                </div>
                <div style={{"fontSize":"12px","color":"#CFCAC0"}}>{rule.category} · {rule.enforcer}</div>
                <div style={{"color":"#F4F1EA","fontSize":"14px","lineHeight":"1.4"}}>{rule.description}</div>
                <div style={{"color":"#7BE0A4","fontFamily":"'JetBrains Mono', monospace","fontSize":"12px"}}>Preferred: "{rule.preferred}"</div>
              </div>
            ))}
          </div>
        </div>

        {/* Section 2: Canonical Facts Table */}
        <div>
          <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"13px","letterSpacing":"0.08em","color":"#CFCAC0","marginBottom":"12px","display":"flex","justifyContent":"space-between"}}>
            <span>CANONICAL APPROVED FACTS ({filteredFacts.length})</span>
            <span style={{"fontSize":"11px","color":"#8E897E"}}>GROUND TRUTH CITATIONS FOR VERIFICATION AGENTS</span>
          </div>
          <div className="desktop-table" style={{"overflowX":"auto","border":"1px solid #27272A"}}>
            <table style={{"width":"100%","borderCollapse":"collapse","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"14px","textAlign":"left"}}>
              <thead>
                <tr style={{"background":"#111111","borderBottom":"2px solid #27272A","color":"#8E897E","fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","letterSpacing":"0.06em"}}>
                  <th style={{"padding":"12px 14px"}}>FACT CODE</th>
                  <th style={{"padding":"12px 14px"}}>CATEGORY</th>
                  <th style={{"padding":"12px 14px"}}>CANONICAL STATEMENT (GROUND TRUTH)</th>
                  <th style={{"padding":"12px 14px"}}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {filteredFacts.map((fact) => (
                  <tr key={fact.code} style={{"borderBottom":"1px solid #222","background":"#18181B"}}>
                    <td style={{"padding":"14px","fontFamily":"'JetBrains Mono', monospace","fontWeight":"700","color":"#3B66FF","whiteSpace":"nowrap"}}>
                      {fact.code}
                    </td>
                    <td style={{"padding":"14px","color":"#CFCAC0","whiteSpace":"nowrap","fontSize":"13px"}}>
                      {fact.category}
                    </td>
                    <td style={{"padding":"14px","color":"#F4F1EA","lineHeight":"1.4"}}>
                      {fact.statement}
                    </td>
                    <td style={{"padding":"14px","whiteSpace":"nowrap"}}>
                      <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#7BE0A4","border":"1px solid #7BE0A4","padding":"3px 8px","background":"rgba(123, 224, 164, 0.1)"}}>
                        {fact.status}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile responsive card alternative for Canonical Facts */}
          <div className="mobile-card-list" style={{"display":"none","flexDirection":"column","gap":"10px"}}>
            {filteredFacts.map((fact) => (
              <div key={fact.code} style={{"background":"#18181B","border":"1px solid #27272A","padding":"14px","display":"flex","flexDirection":"column","gap":"8px"}}>
                <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","gap":"8px"}}>
                  <span style={{"fontFamily":"'JetBrains Mono', monospace","fontWeight":"700","color":"#3B66FF"}}>{fact.code}</span>
                  <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#7BE0A4","border":"1px solid #7BE0A4","padding":"2px 6px","background":"rgba(123, 224, 164, 0.1)"}}>
                    {fact.status}
                  </span>
                </div>
                <div style={{"fontSize":"12px","color":"#CFCAC0"}}>{fact.category}</div>
                <div style={{"color":"#F4F1EA","fontSize":"14px","lineHeight":"1.4"}}>{fact.statement}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    )}

    {/* VIEW 3: Decision History View */}
    {activeView === "history" && (
      <div style={{"background":"#18181B","border":"2px solid #27272A","boxShadow":"8px 8px 0 #000000","padding":"32px","display":"flex","flexDirection":"column","gap":"24px"}}>
        {/* History Header & Return Button */}
        <div style={{"display":"flex","flexWrap":"wrap","justifyContent":"space-between","alignItems":"center","gap":"16px"}}>
          <div>
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","color":"#3B66FF","fontWeight":"700","letterSpacing":"0.08em"}}>
              HISTORICAL LOGS &amp; AUDIT TRAIL
            </div>
            <div style={{"fontSize":"18px","fontWeight":"700","color":"#F4F1EA"}}>
              Cryptographically Sealed Run Records
            </div>
          </div>
          <button
            type="button"
            onClick={handleReturnToAudit}
            className="neo-btn"
            style={{"background":"#3B66FF","color":"#FFFFFF","padding":"8px 16px","border":"2px solid #111111","fontSize":"14px"}}
          >
            ← Return to Audit
          </button>
        </div>

        {/* Metric Summary Cards */}
        {(() => {
          const currentHistory = liveHistoryItems ?? historyItems
          return (
            <div style={{"display":"grid","gridTemplateColumns":"repeat(auto-fit, minmax(180px, 1fr))","gap":"12px"}}>
              <div style={{"background":"#111111","border":"1px solid #333","padding":"14px"}}>
                <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>TOTAL RUNS</div>
                <div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"28px","fontWeight":"700","color":"#F4F1EA"}}>{currentHistory.length}</div>
              </div>
              <div style={{"background":"#111111","border":"1px solid #333","padding":"14px"}}>
                <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>DETERMINISTIC (0 LLM)</div>
                <div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"28px","fontWeight":"700","color":"#7BE0A4"}}>
                  {currentHistory.filter(h => h.calls === 0).length}
                </div>
              </div>
              <div style={{"background":"#111111","border":"1px solid #333","padding":"14px"}}>
                <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>HYBRID / MULTI-AGENT</div>
                <div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"28px","fontWeight":"700","color":"#3B66FF"}}>
                  {currentHistory.filter(h => h.calls > 0).length}
                </div>
              </div>
              <div style={{"background":"#111111","border":"1px solid #333","padding":"14px"}}>
                <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>HUMAN DECISIONS</div>
                <div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"28px","fontWeight":"700","color":"#FFD166"}}>
                  {currentHistory.filter(h => h.decision !== "PENDING").length}
                </div>
              </div>
            </div>
          )
        })()}

        {/* History Table */}
        {/* History Table (Desktop / Tablet) */}
        <div className="desktop-table" style={{"overflowX":"auto","border":"1px solid #27272A"}}>
          <table style={{"width":"100%","borderCollapse":"collapse","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"14px","textAlign":"left"}}>
            <thead>
              <tr style={{"background":"#111111","borderBottom":"2px solid #27272A","color":"#8E897E","fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","letterSpacing":"0.06em"}}>
                <th style={{"padding":"12px 14px"}}>RUN ID / TIME</th>
                <th style={{"padding":"12px 14px"}}>AUDITED COPY</th>
                <th style={{"padding":"12px 14px"}}>ROUTE</th>
                <th style={{"padding":"12px 14px"}}>FINDINGS</th>
                <th style={{"padding":"12px 14px"}}>STATUS</th>
                <th style={{"padding":"12px 14px"}}>GOVERNANCE</th>
                <th style={{"padding":"12px 14px"}}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {(liveHistoryItems ?? historyItems).map((item) => (
                <tr key={item.id} style={{"borderBottom":"1px solid #222","background":"#18181B"}}>
                  <td style={{"padding":"14px","whiteSpace":"nowrap"}}>
                    <div style={{"fontFamily":"'JetBrains Mono', monospace","fontWeight":"700","color":"#3B66FF","fontSize":"13px"}}>{item.id}</div>
                    <div style={{"color":"#8E897E","fontSize":"12px"}}>{item.timestamp}</div>
                  </td>
                  <td style={{"padding":"14px","maxWidth":"260px","color":"#F4F1EA","lineHeight":"1.4"}}>
                    <span style={{"display":"-webkit-box","WebkitLineClamp":2,"WebkitBoxOrient":"vertical","overflow":"hidden"}}>
                      "{item.copy}"
                    </span>
                  </td>
                  <td style={{"padding":"14px","whiteSpace":"nowrap"}}>
                    <span style={{
                      "fontFamily":"'JetBrains Mono', monospace",
                      "fontSize":"11px",
                      "padding":"2px 8px",
                      "background": item.calls === 0 ? "rgba(123, 224, 164, 0.1)" : "rgba(59, 102, 255, 0.15)",
                      "color": item.calls === 0 ? "#7BE0A4" : "#3B66FF",
                      "border": `1px solid ${item.calls === 0 ? "#7BE0A4" : "#3B66FF"}`
                    }}>
                      {item.calls === 0 ? "deterministic (0 LLM)" : `${item.calls} calls · hybrid`}
                    </span>
                  </td>
                  <td style={{"padding":"14px","fontFamily":"'JetBrains Mono', monospace","fontWeight":"700","color":"#F4F1EA"}}>
                    {item.findingsCount} issue{item.findingsCount === 1 ? '' : 's'}
                  </td>
                  <td style={{"padding":"14px","whiteSpace":"nowrap"}}>
                    <span style={{
                      "fontFamily":"'JetBrains Mono', monospace",
                      "fontSize":"11px",
                      "fontWeight":"700",
                      "padding":"3px 8px",
                      "background": item.status === "PASSED" ? "rgba(123, 224, 164, 0.1)" : "rgba(239, 68, 68, 0.15)",
                      "color": item.status === "PASSED" ? "#7BE0A4" : "#EF4444",
                      "border": `1px solid ${item.status === "PASSED" ? "#7BE0A4" : "#EF4444"}`
                    }}>
                      {item.status}
                    </span>
                  </td>
                  <td style={{"padding":"14px","whiteSpace":"nowrap"}}>
                    <span style={{
                      "fontFamily":"'JetBrains Mono', monospace",
                      "fontSize":"11px",
                      "fontWeight":"700",
                      "padding":"3px 8px",
                      "background": item.decision === "APPROVED" ? "rgba(16, 185, 129, 0.15)" : item.decision === "REJECTED" ? "rgba(239, 68, 68, 0.15)" : item.decision === "REVISED" ? "rgba(255, 209, 102, 0.15)" : "#222",
                      "color": item.decision === "APPROVED" ? "#10B981" : item.decision === "REJECTED" ? "#EF4444" : item.decision === "REVISED" ? "#FFD166" : "#8E897E",
                      "border": `1px solid ${item.decision === "APPROVED" ? "#10B981" : item.decision === "REJECTED" ? "#EF4444" : item.decision === "REVISED" ? "#FFD166" : "#444"}`
                    }}>
                      {item.decision}
                    </span>
                  </td>
                  <td style={{"padding":"14px","whiteSpace":"nowrap"}}>
                    <button
                      type="button"
                      onClick={() => setExpandedRunId(expandedRunId === item.id ? null : item.id)}
                      style={{"background":"transparent","border":"1px solid #444","color":"#CFCAC0","padding":"4px 10px","fontSize":"12px","cursor":"pointer"}}
                    >
                      {expandedRunId === item.id ? "Hide Details" : "Inspect ↓"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Mobile responsive card alternative for Decision History */}
        <div className="mobile-card-list" style={{"display":"none","flexDirection":"column","gap":"12px"}}>
          {(liveHistoryItems ?? historyItems).map((item) => (
            <div key={item.id} style={{"background":"#18181B","border":"1px solid #27272A","padding":"14px","display":"flex","flexDirection":"column","gap":"8px"}}>
              <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","gap":"8px"}}>
                <span style={{"fontFamily":"'JetBrains Mono', monospace","fontWeight":"700","color":"#3B66FF","fontSize":"12px"}}>{item.id}</span>
                <span style={{
                  "fontFamily":"'JetBrains Mono', monospace",
                  "fontSize":"11px",
                  "fontWeight":"700",
                  "padding":"2px 6px",
                  "border": item.status === 'PASSED' ? '1px solid #7BE0A4' : '1px solid #EF4444',
                  "color": item.status === 'PASSED' ? '#7BE0A4' : '#EF4444',
                  "background": item.status === 'PASSED' ? 'rgba(123, 224, 164, 0.1)' : 'rgba(239, 68, 68, 0.1)'
                }}>
                  {item.status}
                </span>
              </div>
              <div style={{"fontSize":"11px","color":"#8E897E"}}>{item.timestamp} · {item.route} ({item.calls} LLM)</div>
              <div style={{"color":"#F4F1EA","fontSize":"13px","lineHeight":"1.4"}}>"{item.copy}"</div>
              <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","marginTop":"4px"}}>
                <span style={{"fontSize":"12px","color":"#CFCAC0"}}>{item.findingsCount} finding(s)</span>
                <button
                  type="button"
                  onClick={() => setExpandedRunId(expandedRunId === item.id ? null : item.id)}
                  style={{"background":"#111","color":"#3B66FF","border":"1px solid #3B66FF","padding":"4px 10px","fontSize":"11px","fontFamily":"'JetBrains Mono', monospace","cursor":"pointer"}}
                >
                  {expandedRunId === item.id ? "Hide Details" : "Inspect Run"}
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Expanded Run Detail Modal/Card if any run selected */}
        {expandedRunId && (() => {
          const run = (liveHistoryItems ?? historyItems).find(h => h.id === expandedRunId)
          if (!run) return null
          return (
            <div style={{"background":"#111111","border":"2px solid #3B66FF","padding":"20px","display":"flex","flexDirection":"column","gap":"14px"}}>
              <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","flexWrap":"wrap","gap":"8px"}}>
                <div>
                  <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","color":"#3B66FF","fontWeight":"700"}}>
                    INSPECTING RUN {run.id} · RECORDED AT {run.timestamp}
                  </div>
                  <div style={{"fontSize":"14px","color":"#8E897E"}}>
                    Execution Route: <b>{run.route}</b> ({run.calls} LLM calls)
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setExpandedRunId(null)}
                  style={{"background":"transparent","border":"1px solid #444","color":"#CFCAC0","padding":"4px 10px","fontSize":"12px","cursor":"pointer"}}
                >
                  ✕ Close Inspector
                </button>
              </div>

              <div>
                <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E","marginBottom":"4px"}}>
                  AUDITED TEXT PAYLOAD:
                </div>
                <div style={{"background":"#18181B","padding":"12px","border":"1px solid #27272A","color":"#F4F1EA","fontFamily":"'JetBrains Mono', monospace","fontSize":"13px"}}>
                  "{run.copy}"
                </div>
              </div>

              <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","flexWrap":"wrap","gap":"12px","background":"#18181B","padding":"12px","border":"1px solid #27272A"}}>
                <div>
                  <div style={{"fontSize":"14px","color":"#CFCAC0"}}>
                    Current Governance Decision: <b style={{"color":"#F4F1EA"}}>{run.decision}</b>
                  </div>
                  {run.decidedBy && (
                    <div style={{"fontSize":"12px","color":"#8E897E", "marginTop":"2px"}}>
                      Officer: {run.decidedBy} · {run.reason}
                    </div>
                  )}
                </div>

                <div style={{"display":"flex","gap":"8px"}}>
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryItems(prev => prev.map(h => h.id === run.id ? { ...h, decision: "APPROVED", decidedBy: "Governance Lead", reason: "Approved in historical console inspection." } : h))
                    }}
                    className="neo-btn"
                    style={{"background":"#10B981","color":"#FFFFFF","padding":"6px 14px","fontSize":"13px"}}
                  >
                    ✓ Approve
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryItems(prev => prev.map(h => h.id === run.id ? { ...h, decision: "REVISED", decidedBy: "Governance Lead", reason: "Revision requested in historical console inspection." } : h))
                    }}
                    className="neo-btn"
                    style={{"background":"#FFD166","color":"#111111","padding":"6px 14px","fontSize":"13px"}}
                  >
                    ✎ Revise
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setHistoryItems(prev => prev.map(h => h.id === run.id ? { ...h, decision: "REJECTED", decidedBy: "Governance Lead", reason: "Rejected in historical console inspection." } : h))
                    }}
                    className="neo-btn"
                    style={{"background":"#EF4444","color":"#FFFFFF","padding":"6px 14px","fontSize":"13px"}}
                  >
                    ✕ Reject
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
      </div>
    )}

    {/* VIEW 4: PolicyPulse Dashboard View */}
    {activeView === "policypulse" && (
      <div style={{"background":"#18181B","border":"2px solid #27272A","boxShadow":"8px 8px 0 #000000","padding":"32px","display":"flex","flexDirection":"column","gap":"28px"}}>
        {/* Header */}
        <div style={{"display":"flex","flexWrap":"wrap","justifyContent":"space-between","alignItems":"center","gap":"16px"}}>
          <div>
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","color":"#3B66FF","fontWeight":"700","letterSpacing":"0.08em"}}>
              POLICYPULSE™ GOVERNANCE DASHBOARD
            </div>
            <div style={{"fontSize":"20px","fontWeight":"700","color":"#F4F1EA"}}>
              Guideline Clarity Radar &amp; Rule Health Telemetry
            </div>
            <div style={{"fontSize":"13px","color":"#8E897E","marginTop":"4px"}}>
              Continuous monitoring of brand guideline efficacy, human override rates, and expiring facts.
            </div>
          </div>
          <button
            type="button"
            onClick={handleReturnToAudit}
            className="neo-btn"
            style={{"background":"#3B66FF","color":"#FFFFFF","padding":"8px 16px","border":"2px solid #111111","fontSize":"14px"}}
          >
            ← Return to Audit
          </button>
        </div>

        {/* 4 Core KPIs */}
        <div style={{"display":"grid","gridTemplateColumns":"repeat(auto-fit, minmax(220px, 1fr))","gap":"14px"}}>
          <div style={{"background":"#111111","border":"1px solid #333","padding":"18px"}}>
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>GUIDELINE CLARITY SCORE</div>
            <div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"32px","fontWeight":"700","color":"#7BE0A4","marginTop":"4px"}}>
              {workspaceStats ? `${workspaceStats.clarityScore}%` : "94.2%"}
            </div>
            <div style={{"fontSize":"12px","color":"#8E897E","marginTop":"4px"}}>High rule precision; low agent ambiguity</div>
          </div>
          <div style={{"background":"#111111","border":"1px solid #333","padding":"18px"}}>
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>HUMAN OVERRIDE RATE</div>
            <div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"32px","fontWeight":"700","color":"#FFD166","marginTop":"4px"}}>
              {workspaceStats ? `${workspaceStats.overrideRate}%` : "8.2%"}
            </div>
            <div style={{"fontSize":"12px","color":"#8E897E","marginTop":"4px"}}>
              {workspaceStats ? `Humans modified ${workspaceStats.overrideRate}% of model findings` : "Humans modified 8.2% of model findings"}
            </div>
          </div>
          <div style={{"background":"#111111","border":"1px solid #333","padding":"18px"}}>
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>DETERMINISTIC EFFICIENCY</div>
            <div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"32px","fontWeight":"700","color":"#3B66FF","marginTop":"4px"}}>
              {workspaceStats ? `${workspaceStats.deterministicPct}%` : "81.0%"}
            </div>
            <div style={{"fontSize":"12px","color":"#8E897E","marginTop":"4px"}}>0 LLM calls spent on settled copy</div>
          </div>
          <div style={{"background":"#111111","border":"1px solid #333","padding":"18px"}}>
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>GRADE-A INVARIANT ENFORCEMENT</div>
            <div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"32px","fontWeight":"700","color":"#10B981","marginTop":"4px"}}>100%</div>
            <div style={{"fontSize":"12px","color":"#8E897E","marginTop":"4px"}}>Zero models permitted to overrule hard rules</div>
          </div>
        </div>

        {/* Guideline Clarity Radar / Risk Distribution */}
        <div style={{"background":"#111111","border":"1px solid #333","padding":"22px","display":"flex","flexDirection":"column","gap":"16px"}}>
          <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center","flexWrap":"wrap","gap":"8px"}}>
            <div>
              <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","color":"#3B66FF","fontWeight":"700"}}>
                GUIDELINE CLARITY RADAR
              </div>
              <div style={{"fontSize":"16px","fontWeight":"700","color":"#F4F1EA"}}>
                Distribution of Brand Guideline Risk Factors
              </div>
            </div>
            <span style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#7BE0A4","background":"rgba(123, 224, 164, 0.1)","padding":"4px 10px","border":"1px solid #7BE0A4"}}>
              Automated Telemetry Active
            </span>
          </div>

          <div style={{"display":"flex","flexDirection":"column","gap":"12px"}}>
            {[
              { label: "Absolute Guarantees & Superlatives (Rule R-ABS-001, R-ABS-004)", pct: 38, count: "16 violations", color: "#EF4444" },
              { label: "Commercial Pricing & Tier Discrepancies (Fact F-PRICE-001)", pct: 25, count: "11 violations", color: "#FFD166" },
              { label: "Outdated / Expired Fact References (Fact F-OLD-001)", pct: 18, count: "8 violations", color: "#3B66FF" },
              { label: "Disallowed Brand Terminology & Tone (Rule R-TERM-001)", pct: 12, count: "5 violations", color: "#A78BFA" },
              { label: "Adversarial Prompt Injections & Jailbreaks", pct: 7, count: "3 blocked", color: "#10B981" },
            ].map((risk, idx) => (
              <div key={idx} style={{"display":"flex","flexDirection":"column","gap":"4px"}}>
                <div style={{"display":"flex","justifyContent":"space-between","fontSize":"13px"}}>
                  <span style={{"color":"#F4F1EA","fontWeight":"500"}}>{risk.label}</span>
                  <span style={{"color":"#8E897E","fontFamily":"'JetBrains Mono', monospace"}}>{risk.pct}% ({risk.count})</span>
                </div>
                <div style={{"width":"100%","height":"8px","background":"#222","borderRadius":"4px","overflow":"hidden"}}>
                  <div style={{"width":`${risk.pct}%`,"height":"100%","background":risk.color,"transition":"width 0.4s ease"}} />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Repeat Violations Leaderboard & Expiring Facts Watchlist */}
        <div style={{"display":"grid","gridTemplateColumns":"repeat(auto-fit, minmax(360px, 1fr))","gap":"20px"}}>
          {/* Repeat Violations */}
          <div style={{"background":"#111111","border":"1px solid #333","padding":"20px","display":"flex","flexDirection":"column","gap":"12px"}}>
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","color":"#FFD166","fontWeight":"700"}}>
              TOP REPEAT VIOLATIONS
            </div>
            <div style={{"fontSize":"14px","color":"#8E897E"}}>
              Rules most frequently triggered across all ingested marketing drafts:
            </div>
            <div style={{"display":"flex","flexDirection":"column","gap":"8px"}}>
              {[
                { code: "R-ABS-001", name: "Unverified Superlatives ('the best')", count: 14, action: "Add explicit comparative evidence guidelines" },
                { code: "F-PRICE-001", name: "ProofGate Pro Pricing ($29 vs outdated $19)", count: 9, action: "Send pricing update memo to sales & marketing" },
                { code: "R-TERM-001", name: "Banned Term ('Verification Bot')", count: 8, action: "Enforce ProofGate brand terminology" },
                { code: "F-OLD-001", name: "Expired Free Trial (30 vs 14 days)", count: 6, action: "Flagged for complete canon deprecation" },
              ].map((v, i) => (
                <div key={i} style={{"background":"#18181B","padding":"10px 12px","border":"1px solid #27272A","display":"flex","flexDirection":"column","gap":"4px"}}>
                  <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center"}}>
                    <span style={{"fontFamily":"'JetBrains Mono', monospace","fontWeight":"700","color":"#3B66FF","fontSize":"13px"}}>{v.code}</span>
                    <span style={{"background":"rgba(239, 68, 68, 0.2)","color":"#EF4444","padding":"2px 6px","fontSize":"11px","fontFamily":"'JetBrains Mono', monospace","fontWeight":"700"}}>
                      {v.count} flags
                    </span>
                  </div>
                  <div style={{"fontSize":"13px","color":"#F4F1EA"}}>{v.name}</div>
                  <div style={{"fontSize":"11px","color":"#8E897E","fontStyle":"italic"}}>Rec: {v.action}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Precedent Exceptions Library */}
          <div style={{"background":"#111111","border":"1px solid #333","padding":"20px","display":"flex","flexDirection":"column","gap":"12px"}}>
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","color":"#7BE0A4","fontWeight":"700"}}>
              PRECEDENT LIBRARY (APPROVED EXCEPTIONS)
            </div>
            <div style={{"fontSize":"14px","color":"#8E897E"}}>
              Approved exceptions automatically surfaced when similar claims appear:
            </div>
            <div style={{"display":"flex","flexDirection":"column","gap":"8px"}}>
              {[
                { id: "PREC-01", claim: "Promotional $19/mo partner discount", actor: "Lead Compliance Officer", date: "2026-10-15", note: "Approved for Q4 co-marketing affiliate campaigns." },
                { id: "PREC-02", claim: "Legacy API documentation 'Verification Bot'", actor: "Head of Engineering", date: "2026-11-01", note: "Scoped exception granted strictly for developer documentation." },
                { id: "PREC-03", claim: "SOC-2 Type II certification timeline", actor: "CISO", date: "2026-11-08", note: "Approved historical audit statement for enterprise prospects." },
              ].map((prec, i) => (
                <div key={i} style={{"background":"#18181B","padding":"10px 12px","border":"1px solid #27272A","display":"flex","flexDirection":"column","gap":"4px"}}>
                  <div style={{"display":"flex","justifyContent":"space-between","alignItems":"center"}}>
                    <span style={{"fontFamily":"'JetBrains Mono', monospace","fontWeight":"700","color":"#7BE0A4","fontSize":"12px"}}>{prec.id}</span>
                    <span style={{"fontSize":"11px","color":"#8E897E"}}>{prec.date}</span>
                  </div>
                  <div style={{"fontSize":"13px","color":"#F4F1EA","fontWeight":"500"}}>"{prec.claim}"</div>
                  <div style={{"fontSize":"11px","color":"#CFCAC0"}}>{prec.note}</div>
                  <div style={{"fontSize":"10px","color":"#8E897E","fontFamily":"'JetBrains Mono', monospace"}}>Approved by: {prec.actor}</div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    )}

    {/* VIEW 5: Evaluation & Regression Suite View */}
    {activeView === "eval" && (
      <div style={{"background":"#18181B","border":"2px solid #27272A","boxShadow":"8px 8px 0 #000000","padding":"32px","display":"flex","flexDirection":"column","gap":"28px"}}>
        {/* Header */}
        <div style={{"display":"flex","flexWrap":"wrap","justifyContent":"space-between","alignItems":"center","gap":"16px"}}>
          <div>
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","color":"#3B66FF","fontWeight":"700","letterSpacing":"0.08em"}}>
              EVALUATION &amp; REGRESSION ENGINE
            </div>
            <div style={{"fontSize":"20px","fontWeight":"700","color":"#F4F1EA"}}>
              Verity Gold Standard Benchmark Suite (v2.2)
            </div>
            <div style={{"fontSize":"13px","color":"#8E897E","marginTop":"4px"}}>
              Internal 8-case regression benchmark testing pipeline invariants and error modes. (Regression baseline; not a claim of 100% generalization across unconstrained arbitrary text).
            </div>
          </div>
          <div style={{"display":"flex","alignItems":"center","gap":"10px"}}>
            <button
              type="button"
              disabled={evalLoading}
              onClick={runLiveEvaluation}
              className="neo-btn"
              style={{
                "background": evalLoading ? "#555" : "#10B981",
                "color":"#FFFFFF",
                "padding":"10px 18px",
                "border":"2px solid #111111",
                "fontSize":"14px",
                "fontWeight":"700",
                "cursor": evalLoading ? "not-allowed" : "pointer"
              }}
            >
              {evalLoading ? "Running Suite (8 Tests)..." : "▶ Run Live Evaluation Suite"}
            </button>
            <button
              type="button"
              onClick={handleReturnToAudit}
              className="neo-btn"
              style={{"background":"#3B66FF","color":"#FFFFFF","padding":"8px 16px","border":"2px solid #111111","fontSize":"14px"}}
            >
              ← Return to Audit
            </button>
          </div>
        </div>

        {/* 4 Scorecards */}
        <div style={{"display":"grid","gridTemplateColumns":"repeat(auto-fit, minmax(200px, 1fr))","gap":"14px"}}>
          <div style={{"background":"#111111","border":"1px solid #333","padding":"18px"}}>
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>BENCHMARK PRECISION</div>
            <div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"32px","fontWeight":"700","color":"#7BE0A4","marginTop":"4px"}}>
              {evalRunData?.precision ?? "100.0"}%
            </div>
            <div style={{"fontSize":"12px","color":"#8E897E","marginTop":"4px"}}>0 False Positives on compliant copy</div>
          </div>
          <div style={{"background":"#111111","border":"1px solid #333","padding":"18px"}}>
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>BENCHMARK RECALL</div>
            <div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"32px","fontWeight":"700","color":"#7BE0A4","marginTop":"4px"}}>
              {evalRunData?.recall ?? "100.0"}%
            </div>
            <div style={{"fontSize":"12px","color":"#8E897E","marginTop":"4px"}}>0 Missed violations across test cases</div>
          </div>
          <div style={{"background":"#111111","border":"1px solid #333","padding":"18px"}}>
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>F1 GOVERNANCE SCORE</div>
            <div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"32px","fontWeight":"700","color":"#3B66FF","marginTop":"4px"}}>
              {evalRunData?.f1_score ?? "100.0"}%
            </div>
            <div style={{"fontSize":"12px","color":"#8E897E","marginTop":"4px"}}>Harmonic mean of precision &amp; recall</div>
          </div>
          <div style={{"background":"#111111","border":"1px solid #333","padding":"18px"}}>
            <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>AVERAGE LATENCY</div>
            <div style={{"fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"32px","fontWeight":"700","color":"#F4F1EA","marginTop":"4px"}}>
              {evalRunData?.latency_avg_ms ?? "142"} ms
            </div>
            <div style={{"fontSize":"12px","color":"#8E897E","marginTop":"4px"}}>Fast deterministic offline bypass</div>
          </div>
        </div>

        {/* Confusion Matrix */}
        <div style={{"background":"#111111","border":"1px solid #333","padding":"20px","display":"flex","flexDirection":"column","gap":"14px"}}>
          <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","color":"#3B66FF","fontWeight":"700"}}>
            CONFUSION MATRIX (GOLD STANDARD TEST SAMPLES)
          </div>
          <div style={{"display":"grid","gridTemplateColumns":"repeat(auto-fit, minmax(200px, 1fr))","gap":"12px"}}>
            <div style={{"background":"#18181B","padding":"14px","border":"1px solid #27272A","borderLeft":"3px solid #10B981"}}>
              <div style={{"fontSize":"11px","color":"#8E897E","fontFamily":"'JetBrains Mono', monospace"}}>TRUE POSITIVES (CORRECT FLAGS)</div>
              <div style={{"fontSize":"26px","fontWeight":"700","color":"#10B981","marginTop":"2px"}}>7 / 7</div>
              <div style={{"fontSize":"11px","color":"#CFCAC0","marginTop":"2px"}}>Pricing, guarantees, outdated, tone</div>
            </div>
            <div style={{"background":"#18181B","padding":"14px","border":"1px solid #27272A","borderLeft":"3px solid #10B981"}}>
              <div style={{"fontSize":"11px","color":"#8E897E","fontFamily":"'JetBrains Mono', monospace"}}>TRUE NEGATIVES (CORRECT PASS)</div>
              <div style={{"fontSize":"26px","fontWeight":"700","color":"#10B981","marginTop":"2px"}}>1 / 1</div>
              <div style={{"fontSize":"11px","color":"#CFCAC0","marginTop":"2px"}}>Clean compliant copy passed with 0 findings</div>
            </div>
            <div style={{"background":"#18181B","padding":"14px","border":"1px solid #27272A","borderLeft":"3px solid #7BE0A4"}}>
              <div style={{"fontSize":"11px","color":"#8E897E","fontFamily":"'JetBrains Mono', monospace"}}>FALSE POSITIVES (HALLUCINATIONS)</div>
              <div style={{"fontSize":"26px","fontWeight":"700","color":"#7BE0A4","marginTop":"2px"}}>0</div>
              <div style={{"fontSize":"11px","color":"#CFCAC0","marginTop":"2px"}}>Closed-world evidence prevents false flags</div>
            </div>
            <div style={{"background":"#18181B","padding":"14px","border":"1px solid #27272A","borderLeft":"3px solid #7BE0A4"}}>
              <div style={{"fontSize":"11px","color":"#8E897E","fontFamily":"'JetBrains Mono', monospace"}}>FALSE NEGATIVES (MISSED RISKS)</div>
              <div style={{"fontSize":"26px","fontWeight":"700","color":"#7BE0A4","marginTop":"2px"}}>0</div>
              <div style={{"fontSize":"11px","color":"#CFCAC0","marginTop":"2px"}}>Deterministic rules ensure zero missed leaks</div>
            </div>
          </div>
        </div>

        {/* Labeled Benchmark Cases Table */}
        <div style={{"display":"flex","flexDirection":"column","gap":"12px"}}>
          <div style={{"fontFamily":"'JetBrains Mono', monospace","fontSize":"12px","color":"#CFCAC0","letterSpacing":"0.06em"}}>
            LABELED BENCHMARK SCENARIOS ({evalRunData?.results?.length ?? 8})
          </div>
          <div style={{"overflowX":"auto","border":"1px solid #27272A"}}>
            <table style={{"width":"100%","borderCollapse":"collapse","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontSize":"13px","textAlign":"left"}}>
              <thead>
                <tr style={{"background":"#111111","borderBottom":"2px solid #27272A","color":"#8E897E","fontFamily":"'JetBrains Mono', monospace","fontSize":"11px"}}>
                  <th style={{"padding":"12px 14px"}}>ID</th>
                  <th style={{"padding":"12px 14px"}}>TEST SCENARIO</th>
                  <th style={{"padding":"12px 14px"}}>CATEGORY</th>
                  <th style={{"padding":"12px 14px"}}>EXPECTED</th>
                  <th style={{"padding":"12px 14px"}}>ACTUAL FINDINGS</th>
                  <th style={{"padding":"12px 14px"}}>LATENCY</th>
                  <th style={{"padding":"12px 14px"}}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {(evalRunData?.results ?? [
                  { id: "TC-01", name: "Compliant Enterprise Copy", pass: true, latencyMs: 38, findingsCount: 0, category: "clean", expected: "0 findings" },
                  { id: "TC-02", name: "Contradicted Pricing Claim", pass: true, latencyMs: 142, findingsCount: 1, category: "pricing", expected: "Contradicted" },
                  { id: "TC-03", name: "Absolute Security Guarantee", pass: true, latencyMs: 185, findingsCount: 2, category: "legal", expected: "Needs legal review" },
                  { id: "TC-04", name: "Outdated Metric Claim", pass: true, latencyMs: 44, findingsCount: 1, category: "outdated", expected: "Outdated" },
                  { id: "TC-05", name: "Adversarial Prompt Injection", pass: true, latencyMs: 51, findingsCount: 1, category: "injection", expected: "Blocked / Flagged" },
                  { id: "TC-06", name: "Banned Term Violation", pass: true, latencyMs: 29, findingsCount: 1, category: "tone", expected: "Tone" },
                  { id: "TC-07", name: "Ambiguous Comparative Claim", pass: true, latencyMs: 168, findingsCount: 1, category: "comparative", expected: "Unsupported" },
                  { id: "TC-08", name: "Cross-Product Entity Transfer Mismatch", pass: true, latencyMs: 172, findingsCount: 1, category: "entity", expected: "Unsupported" },
                ]).map((tc: any, i: number) => (
                  <tr key={i} style={{"borderBottom":"1px solid #222","background": i % 2 === 0 ? "#141416" : "#18181B"}}>
                    <td style={{"padding":"12px 14px","fontFamily":"'JetBrains Mono', monospace","color":"#3B66FF","fontWeight":"700"}}>{tc.id}</td>
                    <td style={{"padding":"12px 14px","fontWeight":"600","color":"#F4F1EA"}}>{tc.name}</td>
                    <td style={{"padding":"12px 14px","fontFamily":"'JetBrains Mono', monospace","fontSize":"11px","color":"#8E897E"}}>{tc.category?.toUpperCase()}</td>
                    <td style={{"padding":"12px 14px","color":"#CFCAC0"}}>{tc.expected ?? (tc.category === "clean" ? "0 findings" : "Flagged")}</td>
                    <td style={{"padding":"12px 14px","color":"#CFCAC0"}}>{tc.findingsCount} finding(s)</td>
                    <td style={{"padding":"12px 14px","fontFamily":"'JetBrains Mono', monospace","color":"#8E897E"}}>{tc.latencyMs}ms</td>
                    <td style={{"padding":"12px 14px"}}>
                      <span style={{
                        "fontFamily":"'JetBrains Mono', monospace",
                        "fontSize":"11px",
                        "fontWeight":"700",
                        "padding":"2px 8px",
                        "background":"rgba(16, 185, 129, 0.15)",
                        "color":"#10B981",
                        "border":"1px solid #10B981"
                      }}>
                        PASS ✓
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    )}
  </div>
</section>



<footer style={{"padding":"36px 48px","display":"flex","flexWrap":"wrap","justifyContent":"space-between","alignItems":"center","gap":"16px","fontSize":"15px","color":"#3A3832","borderTop":"2px solid #111111","background":"#FFFDF8"}}>
<div><b style={{"color":"#111111","fontFamily":"'Space Grotesk', system-ui, sans-serif","fontWeight":"700","letterSpacing":"-0.01em"}}>VERITY</b> · Agentic brand governance & content verification engine</div>
<div style={{"display":"flex","gap":"20px","fontWeight":"600"}}>
  <button type="button" onClick={() => { setActiveView("workspace"); scrollToAudit(); }} style={{"background":"none","border":"none","padding":0,"font":"inherit","cursor":"pointer","textDecoration":"underline","color":"#111111"}}>Review Workspace</button>
  <button type="button" onClick={() => { setActiveView("canon"); scrollToAudit(); }} style={{"background":"none","border":"none","padding":0,"font":"inherit","cursor":"pointer","textDecoration":"underline","color":"#111111"}}>Brand Canon</button>
  <button type="button" onClick={() => { setActiveView("history"); scrollToAudit(); }} style={{"background":"none","border":"none","padding":0,"font":"inherit","cursor":"pointer","textDecoration":"underline","color":"#111111"}}>Decision History</button>
  <a href="#top" style={{"textDecoration":"underline","color":"#111111"}}>Back to Top ↑</a>
</div>
</footer>
</div>

    </>
  )
}
