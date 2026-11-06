/**
 * Provider-agnostic LLM types. The review engine only ever talks to these
 * interfaces, so swapping Gemini for OpenRouter or Cloudflare never touches
 * review logic.
 */

export type ProviderErrorKind =
  | "quota" // 429 / rate limited: do NOT retry on the same provider, fall back
  | "timeout" // transient
  | "network" // transient
  | "server" // 5xx, including Gemini 503 "overloaded": transient
  | "auth" // bad or missing key: open the circuit for a long time
  | "bad_request" // our request was wrong: retrying will not help
  | "bad_response" // provider answered, but with nothing usable
  | "not_configured"
  | "circuit_open"

export class ProviderError extends Error {
  readonly provider: string
  readonly kind: ProviderErrorKind
  readonly status: number | null
  readonly retryAfterMs: number | null

  constructor(
    provider: string,
    kind: ProviderErrorKind,
    message: string,
    options: { status?: number | null; retryAfterMs?: number | null } = {}
  ) {
    super(message)
    this.name = "ProviderError"
    this.provider = provider
    this.kind = kind
    this.status = options.status ?? null
    this.retryAfterMs = options.retryAfterMs ?? null
  }

  /** Worth retrying on the same provider. Quota and auth errors are not. */
  get transient(): boolean {
    return this.kind === "timeout" || this.kind === "network" || this.kind === "server"
  }
}

export function classifyStatus(status: number): ProviderErrorKind {
  if (status === 429) return "quota"
  if (status === 401 || status === 403) return "auth"
  if (status === 408) return "timeout"
  if (status >= 500) return "server"
  return "bad_request"
}

export interface GenerateInput {
  system: string
  prompt: string
  /** Overrides the provider's default model for this call. */
  model?: string
  timeoutMs: number
  /** Ask the provider for JSON output where it supports a JSON mode. */
  json?: boolean
}

export interface GenerateResult {
  text: string
  model: string
  provider: string
  latencyMs: number
  usage?: { inputTokens?: number; outputTokens?: number }
}

export interface LLMProvider {
  readonly name: string
  readonly defaultModel: string
  isConfigured(): boolean
  generate(input: GenerateInput): Promise<GenerateResult>
}
