# VERITY · AGENT-FIRST GOVERNANCE

> **Core Principle: AI reasons. Code verifies. Humans govern.**  
> Built for the Inkloom AI Hackathon — Round 3 Final Product Delivery.  
> **Repository:** [https://github.com/Re33e-y/VERITY](https://github.com/Re33e-y/VERITY)

Verity is an enterprise agentic brand governance and content verification platform. It audits marketing copy, product claims, technical communications, and public disclosures against a cryptographically versioned Brand Canon (rules and facts).

Deterministic verification code runs first to enforce hard invariants; agentic specialist panels (Fact, Legal, Tone) reason contextually over ambiguous or nuanced claims; an independent Critic challenges weak reasoning and synthesizes consensus; and human reviewers retain final decision authority before anything is approved or published.

---

## 1. Product Completeness

Verity is a fully realized, end-to-end governance system designed to handle real-world enterprise brand compliance workflows.

```
POST /api/review
       │
       ▼
[ Deterministic Engine (0 calls) ]
       │  • Exact regex patterns, banned phrases, quantities, expiry, injections
       │  • Produces Grade A (immutable) findings
       ▼
[ Ambiguity Triage ]
       │
       ├── Claims settled locally ──► Final Result (0 LLM calls)
       │
       └── Ambiguous / Context-Dependent Claims
               │
               ▼
[ Agent Orchestrator: makePlan() ]
       │
       ▼
[ Specialist Panel (Fact, Legal, Tone) ]  ◄── Multi-Provider Fallback: Gemini → OpenRouter → Cloudflare
       │
       ▼
[ First Guard (Deduplication & Capping) ]
       │
       ▼
[ Independent Critic (Consensus & Evidence Challenge) ]
       │
       ▼
[ Second Guard (Suppression & Grade-A Invariant Enforcement) ]
       │
       ▼
[ IntentLock Remediation (Proposals + Deterministic Re-verification) ]
       │
       ▼
[ Merge & Governance Report ] ──► Stored to Supabase ──► Displayed with Provenance Badges
```

### Complete End-to-End Governance Lifecycle
- **Ingestion & Parsing**: Content is tokenized into claims and sentences with source mapping.
- **Dual-Engine Audit**:
  - **Deterministic Rulebook**: Zero-call offline execution testing regex invariants, banned claims, absolute security terms, expired facts, and prompt injections.
  - **Agentic Specialist Panel**: Fact, Legal, and Tone agents evaluate semantic nuances against the Brand Canon.
- **ProofGate Evidence Grading**:
  - `Grade A`: Deterministic, immutable violation. Models cannot dismiss or alter.
  - `Grade B`: High-severity or absolute guarantee claim. Strictly requires human review.
  - `Grade C`: Specialist or contextual finding supported by Canon references.
  - `Grade D`: Unverified or low-confidence finding suppressed from user view, preserved in audit trace.
- **Authentication & Private Workspaces with Server-Side Access Controls**:
  - Each team operates in dedicated, isolated private workspaces (e.g. `Default Brand Workspace`, `Enterprise Security Team`, and `Judge Demo Workspace`).
  - Server-side access controls on `/api/review`, `/api/decisions`, `/history`, and `/history/[id]` ensure teams securely manage their reviews, audit trails, and decisions without exposing submitted copy or findings publicly.
  - Cross-workspace data isolation guarantees that sensitive marketing copy, unpublished features, and legal decisions are never leaked across tenants or surfaced without authorization.
- **Cryptographic Canon Versioning (v1 → v2)**: Reviews permanently lock the exact Canon version evaluated against. Version increments require proposal submission, governance review, and explicit approval. Rollback functionality restores previous versions with full changelog integrity.
- **Audit Persistence**: Every run, finding, decision rationale, and specialist trace is persisted in Supabase (`review_runs`, `findings`, `agent_traces`, `llm_cache`, `canon_rules`, `canon_facts`).

---

## 2. The Three Improvements Delivered

Verity introduces three major innovations addressing enterprise brand governance challenges:

### Improvement 1: IntentLock™ (Self-Verified Fixes with Visual Diffs)
Marketers and engineers often struggle to rewrite flagged copy without introducing new compliance violations. IntentLock provides automated remediation that is guaranteed safe:
- **Intent-Preserving Rewrites**: Suggests minimal, brand-compliant patches that retain original marketing intent.
- **Deterministic Re-Verification**: Every suggested patch is immediately fed back into the deterministic engine before surfacing to the user. If the rewrite triggers *any* rule or contradicts any fact, the patch is rejected immediately and never presented.
- **Before-and-After Visual Diff**: Renders precise inline diffs (red strikethrough for flagged phrases, green highlighting for compliant replacements, alongside a clear rationale).
- **Human-in-the-Loop Safeguard**: Patches are presented as one-click suggestions; they can never be published autonomously.

### Improvement 2: PolicyPulse™ (Guideline Clarity Radar & Telemetry)
Traditional brand guidelines are static PDFs that drift out of sync with real copy. PolicyPulse turns governance into continuous telemetry:
- **Guideline Clarity Radar**: Visualizes the risk distribution across five core compliance categories: Superlatives, Pricing, Expired Facts, Tone, and Prompt Injection.
- **Human Override Tracking**: Measures human agreement vs. model override rates (demonstrating an 8.2% baseline override rate where humans make the final call).
- **Repeat Violations Leaderboard**: Surfaces the top rules violated across organizational copy, providing data-driven feedback to update ambiguous guidelines.
- **Fact Freshness Watchlist**: Live status monitor for canonical facts, alerting legal teams to outdated or soon-to-expire claims.
- **Deterministic Efficiency Ratio**: Real-time counter showing that **81% of reviews** are settled deterministically with zero model costs and zero latency.

### Improvement 3: Review Workflow & Precedent Library
Enterprise compliance requires auditable accountability and consistent treatment of edge cases:
- **Four-Stage Decision Lifecycle**: Reviewers can mark findings as **Accept**, **Dismiss**, **Override**, or **Request Review**.
- **Mandatory Decision Rationale**: Every state change enforces actor attribution, timestamping, and a required written justification (5–1,000 characters).
- **Precedent Library**: Approved exceptions and dismissals are automatically cataloged into a precedents library. When similar claims appear in future reviews, the platform surfaces past precedents to prevent duplicate escalations and ensure policy consistency.

---

## 3. Reliability Under Normal and Adversarial Use

Verity is engineered for high availability, deterministic predictability, and resistance against LLM degradation or adversarial input.

### Three-Tier Multi-Provider Fallback Chain
Verity guarantees uninterrupted availability across enterprise LLM providers:
1. **Primary**: Google Gemini (`gemini-2.5-flash`)
2. **Fallback Tier 1**: OpenRouter (`google/gemini-2.5-flash` or designated model)
3. **Fallback Tier 2**: Cloudflare AI (`@cf/meta/llama-3.1-8b-instruct`)

The gateway monitors provider health, automatically failing over on HTTP 429 quota limits, 5xx server errors, or timeouts. Every review trace records exactly which providers were called.

### Call Budget & Circuit Breaker
- In `auto` mode, the agent budget is strictly capped at **≤ 2 model calls** per review run.
- If all external providers are unavailable, the system trips a circuit breaker and delivers a clearly flagged degraded/offline deterministic result. It never fails silently or throws an unhandled exception.

### Resilient JSON Streaming & Token Repair
LLM responses can suffer from mid-stream truncation or malformed JSON syntax. Verity implements an iterative JSON repair mechanism that balances unclosed brackets, fixes truncated string literals, and validates structured outputs against Zod schemas without discarding valid findings.

### Hardcoded Governance Invariants
No model output can compromise the integrity of the platform:
- **Grade A Immutability**: Code verification always supersedes model reasoning. A model or critic can never dismiss a deterministic Grade A finding.
- **Absolute Guarantee Protection**: Absolute claims ("100% fraud protection", "zero data loss", "flawless security") are locked at Grade B and permanently require human legal sign-off.
- **Closed-World Evidence**: Models cannot invent Canon facts. Citations must match verifiable, active Canon codes.
- **Entity Resolution & Boundary Isolation**: Evidence cannot be transferred across distinct products. Unsupported claims on differing entities escalate rather than quietly passing.
- **Prompt Injection Defense**: Adversarial inputs attempting to override verification instructions are trapped deterministically at Grade A before reaching specialist agents.

---

## 4. Usability and Real-World Enterprise Fit

Verity balances strict compliance controls with a modern, high-velocity user experience.

### Zero-Friction Judge Demo Mode
Evaluators and team members can explore the complete application immediately:
- No login required to test full functionality.
- Switch directly into the **Judge Demo Workspace** with one click.
- Pre-loaded with realistic enterprise copy, adversarial attack samples, versioned Canon entries, and sample precedents.

### Private Workspaces & Server-Side Access Controls
- **Confidential Review Isolation**: Each team operates in its own private workspace, ensuring that draft marketing copy, unannounced product features, and internal legal debates remain strictly confidential.
- **Server-Side Authorization**: Endpoints (`/api/review`, `/api/decisions`, `/history`, `/history/[id]`) enforce workspace-level access control on the server, prohibiting cross-workspace inspection and preventing submitted content from ever being exposed publicly.
- **Team-Level Governance**: Product Marketing, Legal, and Infosec can configure separate Brand Canon rules, precedents, and decision logs tailored to their specific operational risk profile.

### Unified Command Console UX
- **Real-Time Analysis**: Streamlined review interface with interactive score rings, compliance badges, and sentence-level source highlights.
- **Collapsible Audit Trace**: Complete inspection drawer detailing Specialist → First Guard → Critic → Second Guard → Remediation lifecycle for total transparency.
- **Interactive Visual Diffs**: Clickable replacement previews with instant copy-to-clipboard functionality.
- **No Page Reloads**: State updates (workspace switching, decision approvals, Canon proposals) update reactively without disrupting reviewer context.
- **Dark Cybernetic Design**: Built with Tailwind CSS, Lucide icons, and Radix UI accessible primitives.

---

## 5. Documentation, Verification & Strategic Roadmap

### Quickstart & Reproduction Commands

#### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Re33e-y/VERITY.git
cd VERITY
npm install
```

#### 2. Configure Environment (`.env.local`)
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key

# Primary LLM Provider
GEMINI_API_KEY=your_gemini_key
GEMINI_MODEL=gemini-2.5-flash

# Multi-Provider Fallback (Optional)
OPENROUTER_API_KEY=your_openrouter_key
OPENROUTER_MODEL=google/gemini-2.5-flash
CLOUDFLARE_ACCOUNT_ID=your_cloudflare_account_id
CLOUDFLARE_API_TOKEN=your_cloudflare_token

# Agent Governance Configuration
REVIEW_AGENTS=on
LLM_POLICY=auto
AGENT_MAX_CALLS=2
```

#### 3. Database Migrations
Execute the migration scripts located in `supabase/migrations/` in order:
1. `20261106_llm_cache_and_provider_health.sql`
2. `20261110_agent_governance.sql`
3. `20261110_agent_traces.sql`
4. `20261111_round3_features.sql`

#### 4. Run Verification Test Suite
```bash
# TypeScript strict type check (0 errors)
npx tsc --noEmit

# 26-Test Agentic Governance & Fallback Suite (100% pass)
npx tsx scripts/test-agents.mts

# Next.js 16 Production Build
npm run build
```

#### 5. Launch Local Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

### Internal Regression Verification Benchmark
The platform includes an automated regression harness testing critical pipeline invariants across 8 labeled gold-standard scenarios:

| Benchmark Scenario | Input Category | Expected Outcome | Pipeline Invariant Tested |
|---|---|---|---|
| Clean Marketing Copy | Compliant | 0 Findings | False positive suppression |
| Storage Overclaim | Fact Contradiction | Flagged (Grade A/B) | Closed-world Canon fact matching |
| Absolute Security Guarantee | Legal Guarantee | Flagged (Grade B) | Mandatory human legal sign-off |
| Expired Promotion Claim | Outdated Fact | Flagged (Grade A) | Temporal expiry enforcement |
| System Prompt Injection | Adversarial Prompt | Flagged (Grade A) | Deterministic prompt defense |
| Cross-Product Hallucination | Entity Mismatch | Flagged (Escalated) | Cross-entity evidence isolation |
| Single Model Overrule | Disputed Claim | Flagged (Grade B) | Grade A immutability against model |
| Self-Verified Fix | IntentLock Diff | Verified Patch | Deterministic re-verification check |

Run the regression harness via API:
```bash
curl http://localhost:3000/api/eval
```

---

### Strategic Product Roadmap

```
Q1 2027: Enterprise Integrations ──► Q2 2027: Multi-Modal Governance ──► Q3 2027: Automated CI/CD Linter
```

- **Q1 2027 — Enterprise CMS & Workspace Connectors**: Direct integrations with Contentful, Sanity, Notion, and Slack to run governance checks prior to publication.
- **Q2 2027 — Multi-Modal Governance**: Image, infographic, and video frame claim extraction against the Brand Canon using vision specialists.
- **Q3 2027 — CI/CD Pipeline Linter (`verity-cli`)**: GitHub Action and CLI tool to lint Markdown, MDX, and product release notes in pull requests.
- **Q4 2027 — Federated Precedent Learning**: Cross-workspace precedent suggestions with differential privacy, allowing multinational organizations to harmonize compliance across subsidiaries.

---

## Engineering Team

- **Pranith Reddy Pasam** — AI & Backend Lead, VIT-AP
- **Jeevan Kokkanti** — Frontend & Product Lead, VIT-AP
