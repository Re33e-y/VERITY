import {
  ProviderError,
  type GenerateInput,
  type GenerateResult,
  type LLMProvider,
  type ProviderErrorKind,
} from "./types"
import { defaultSleep } from "./util"

export interface GatewayEvent {
  type: "attempt_ok" | "attempt_failed" | "skipped" | "circuit_opened"
  provider: string
  model?: string
  kind?: ProviderErrorKind
  status?: number | null
  latencyMs?: number
  detail?: string
}

export interface AttemptRecord {
  provider: string
  model: string
  ok: boolean
  kind?: ProviderErrorKind
  latencyMs: number
}

export interface BreakerConfig {
  /** Consecutive transient failures before the circuit opens. */
  failureThreshold: number
  cooldownMs: number
  quotaCooldownMs: number
  authCooldownMs: number
}

const DEFAULT_BREAKER: BreakerConfig = {
  failureThreshold: 3,
  cooldownMs: 60_000,
  quotaCooldownMs: 120_000,
  authCooldownMs: 600_000,
}

interface BreakerState {
  consecutiveFailures: number
  openUntil: number
}

/**
 * Per-provider circuit breaker. State is in memory, so on serverless it is per
 * instance: good enough to stop one burst hammering a dead provider, not a
 * global health signal (that is what the provider_health table is for).
 */
export class CircuitBreaker {
  private readonly states = new Map<string, BreakerState>()

  constructor(
    private readonly config: BreakerConfig,
    private readonly now: () => number
  ) {}

  isOpen(provider: string): boolean {
    return (this.states.get(provider)?.openUntil ?? 0) > this.now()
  }

  recordSuccess(provider: string): void {
    this.states.set(provider, { consecutiveFailures: 0, openUntil: 0 })
  }

  /** Returns true when this failure opened the circuit. */
  recordFailure(provider: string, error: ProviderError): boolean {
    const state = this.states.get(provider) ?? { consecutiveFailures: 0, openUntil: 0 }

    if (error.kind === "quota") {
      const wait = error.retryAfterMs ?? this.config.quotaCooldownMs
      state.openUntil = this.now() + Math.min(Math.max(wait, 1_000), 600_000)
      this.states.set(provider, state)
      return true
    }
    if (error.kind === "auth") {
      state.openUntil = this.now() + this.config.authCooldownMs
      this.states.set(provider, state)
      return true
    }
    if (error.transient) {
      // Not reset when the cooldown ends: one more failure re-opens at once.
      state.consecutiveFailures += 1
      if (state.consecutiveFailures >= this.config.failureThreshold) {
        state.openUntil = this.now() + this.config.cooldownMs
        this.states.set(provider, state)
        return true
      }
    }
    this.states.set(provider, state)
    return false
  }

  snapshot(): Record<string, { open: boolean; consecutiveFailures: number; reopensInMs: number }> {
    const out: Record<string, { open: boolean; consecutiveFailures: number; reopensInMs: number }> = {}
    for (const [name, state] of this.states) {
      out[name] = {
        open: state.openUntil > this.now(),
        consecutiveFailures: state.consecutiveFailures,
        reopensInMs: Math.max(0, state.openUntil - this.now()),
      }
    }
    return out
  }
}

export class GatewayExhaustedError extends Error {
  readonly attempts: AttemptRecord[]
  readonly reason: "no_provider_available" | "all_attempts_failed" | "deadline"
  readonly lastError: ProviderError | null

  constructor(
    reason: GatewayExhaustedError["reason"],
    attempts: AttemptRecord[],
    lastError: ProviderError | null
  ) {
    super(
      reason === "no_provider_available"
        ? "No LLM provider is configured and available."
        : `LLM gateway exhausted (${reason})${lastError ? `: ${lastError.message}` : ""}`
    )
    this.name = "GatewayExhaustedError"
    this.reason = reason
    this.attempts = attempts
    this.lastError = lastError
  }
}

export interface GatewayOptions {
  providers: LLMProvider[]
  /** Attempts on the first provider (retries only for transient errors). */
  maxAttemptsPerProvider?: number
  /** Providers tried per call: one primary plus one fallback by default. */
  maxProvidersPerCall?: number
  /** Hard cap on HTTP attempts per call. */
  maxTotalAttempts?: number
  /** Wall-clock budget per call; keep well under the platform function limit. */
  deadlineMs?: number
  backoffBaseMs?: number
  maxRetryAfterMs?: number
  breaker?: Partial<BreakerConfig>
  onEvent?: (event: GatewayEvent) => void
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

export interface CallOptions {
  /** Try other providers first, so a verifier is independent of the judge. */
  avoidProvider?: string
  /** Model names are provider specific: map provider name to model. */
  modelByProvider?: Record<string, string>
}

export type GatewayResult = GenerateResult & { attempts: AttemptRecord[] }

const MIN_ATTEMPT_MS = 1_000
const DEFAULT_CALL_TIMEOUT_MS = 20_000

export class ProviderGateway {
  readonly breaker: CircuitBreaker
  private readonly providers: LLMProvider[]
  private readonly maxAttemptsPerProvider: number
  private readonly maxProvidersPerCall: number
  private readonly maxTotalAttempts: number
  private readonly deadlineMs: number
  private readonly backoffBaseMs: number
  private readonly maxRetryAfterMs: number
  private readonly onEvent: (event: GatewayEvent) => void
  private readonly now: () => number
  private readonly sleep: (ms: number) => Promise<void>
  private readonly counters = new Map<string, { ok: number; failed: number }>()

  constructor(options: GatewayOptions) {
    this.providers = options.providers
    this.maxAttemptsPerProvider = Math.max(1, options.maxAttemptsPerProvider ?? 2)
    this.maxProvidersPerCall = Math.max(1, options.maxProvidersPerCall ?? 2)
    this.maxTotalAttempts = Math.max(1, options.maxTotalAttempts ?? 3)
    this.deadlineMs = options.deadlineMs ?? 25_000
    this.backoffBaseMs = options.backoffBaseMs ?? 400
    this.maxRetryAfterMs = options.maxRetryAfterMs ?? 3_000
    this.onEvent = options.onEvent ?? (() => undefined)
    this.now = options.now ?? Date.now
    this.sleep = options.sleep ?? defaultSleep
    this.breaker = new CircuitBreaker({ ...DEFAULT_BREAKER, ...options.breaker }, this.now)
  }

  /** True when at least one provider is configured and its circuit is closed. */
  isAvailable(): boolean {
    return this.providers.some((p) => p.isConfigured() && !this.breaker.isOpen(p.name))
  }

  providerNames(): string[] {
    return this.providers.map((p) => p.name)
  }

  stats(): Record<string, { ok: number; failed: number }> {
    return Object.fromEntries(this.counters)
  }

  private eligibleProviders(avoid?: string): LLMProvider[] {
    const usable: LLMProvider[] = []
    for (const provider of this.providers) {
      if (!provider.isConfigured()) {
        this.onEvent({ type: "skipped", provider: provider.name, kind: "not_configured" })
        continue
      }
      if (this.breaker.isOpen(provider.name)) {
        this.onEvent({ type: "skipped", provider: provider.name, kind: "circuit_open" })
        continue
      }
      usable.push(provider)
    }
    if (!avoid) return usable
    return [...usable.filter((p) => p.name !== avoid), ...usable.filter((p) => p.name === avoid)]
  }

  private count(provider: string, ok: boolean): void {
    const entry = this.counters.get(provider) ?? { ok: 0, failed: 0 }
    if (ok) entry.ok += 1
    else entry.failed += 1
    this.counters.set(provider, entry)
  }

  async generate(
    input: Omit<GenerateInput, "timeoutMs" | "model"> & { timeoutMs?: number },
    options: CallOptions = {}
  ): Promise<GatewayResult> {
    const startedAt = this.now()
    const attempts: AttemptRecord[] = []
    const eligible = this.eligibleProviders(options.avoidProvider)
    if (eligible.length === 0) throw new GatewayExhaustedError("no_provider_available", attempts, null)

    let lastError: ProviderError | null = null
    let providersTried = 0
    let hitDeadline = false

    providerLoop: for (const provider of eligible) {
      if (providersTried >= this.maxProvidersPerCall) break
      providersTried += 1
      // Retries are for the primary only; a fallback gets one clean shot.
      const maxAttempts = providersTried === 1 ? this.maxAttemptsPerProvider : 1

      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        if (attempts.length >= this.maxTotalAttempts) break providerLoop
        const remaining = this.deadlineMs - (this.now() - startedAt)
        if (remaining < MIN_ATTEMPT_MS) {
          hitDeadline = true
          break providerLoop
        }

        const model = options.modelByProvider?.[provider.name] ?? provider.defaultModel
        const timeoutMs = Math.min(input.timeoutMs ?? DEFAULT_CALL_TIMEOUT_MS, remaining)

        try {
          const result = await provider.generate({
            system: input.system,
            prompt: input.prompt,
            ...(input.json !== undefined ? { json: input.json } : {}),
            ...(options.modelByProvider?.[provider.name]
              ? { model: options.modelByProvider[provider.name] as string }
              : {}),
            timeoutMs,
          })
          this.breaker.recordSuccess(provider.name)
          this.count(provider.name, true)
          attempts.push({ provider: provider.name, model: result.model, ok: true, latencyMs: result.latencyMs })
          this.onEvent({
            type: "attempt_ok",
            provider: provider.name,
            model: result.model,
            latencyMs: result.latencyMs,
          })
          return { ...result, attempts }
        } catch (error) {
          const providerError =
            error instanceof ProviderError
              ? error
              : new ProviderError(
                  provider.name,
                  "network",
                  error instanceof Error ? error.message : "unknown provider failure"
                )
          lastError = providerError
          this.count(provider.name, false)
          attempts.push({
            provider: provider.name,
            model,
            ok: false,
            kind: providerError.kind,
            latencyMs: 0,
          })
          this.onEvent({
            type: "attempt_failed",
            provider: provider.name,
            model,
            kind: providerError.kind,
            status: providerError.status,
            detail: providerError.message,
          })
          if (this.breaker.recordFailure(provider.name, providerError)) {
            this.onEvent({ type: "circuit_opened", provider: provider.name, kind: providerError.kind })
          }

          // Quota, auth and bad requests will not improve by retrying here.
          if (!providerError.transient) continue providerLoop

          if (attempt + 1 < maxAttempts) {
            const backoff = this.backoffBaseMs * 2 ** attempt
            const wait = Math.min(Math.max(backoff, providerError.retryAfterMs ?? 0), this.maxRetryAfterMs)
            await this.sleep(wait)
          }
        }
      }
    }

    throw new GatewayExhaustedError(hitDeadline ? "deadline" : "all_attempts_failed", attempts, lastError)
  }
}
