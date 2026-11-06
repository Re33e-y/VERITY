import { ProviderGateway, type GatewayEvent } from "../llm/gateway"
import { createCloudflareProvider } from "../llm/providers/cloudflare"
import { createGeminiProvider } from "../llm/providers/gemini"
import { createOpenRouterProvider } from "../llm/providers/openrouter"
import type { LLMProvider } from "../llm/types"
import { MemoryCache, SupabaseCache, TieredCache, type SupabaseLike } from "./cache"
import { HealthRecorder } from "./health"
import { ReviewEngine, DEFAULT_CONFIG, type EngineConfig } from "./orchestrator"
import type { LlmPolicy } from "./risk"
import type { LocalEngine } from "./local"

type Env = Record<string, string | undefined>

function intFrom(value: string | undefined, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback
}

export function loadEngineConfig(env: Env): EngineConfig {
  // LLM_MODE=off is the older switch from the first router; keep honoring it.
  const policy: LlmPolicy =
    env.LLM_MODE === "off" ? "never"
    : env.LLM_POLICY === "never" || env.LLM_POLICY === "always" ? env.LLM_POLICY
    : "auto"

  const judgeModel = env.GEMINI_MODEL ?? "gemini-2.5-flash"
  const verifierModel = env.VERIFIER_MODEL ?? judgeModel

  return {
    ...DEFAULT_CONFIG,
    policy,
    maxLlmCalls: Math.min(intFrom(env.LLM_MAX_CALLS, 2), 2),
    maxContentChars: intFrom(env.REVIEW_MAX_CHARS, DEFAULT_CONFIG.maxContentChars),
    cacheTtlSeconds: intFrom(env.LLM_CACHE_TTL_SECONDS, DEFAULT_CONFIG.cacheTtlSeconds),
    judgeModelId: judgeModel,
    verifierModelId: verifierModel,
    verifierModelByProvider: env.VERIFIER_MODEL ? { gemini: env.VERIFIER_MODEL } : {},
  }
}

export function createProviders(env: Env): LLMProvider[] {
  const available: Record<string, LLMProvider> = {
    gemini: createGeminiProvider({
      ...(env.GEMINI_API_KEY ? { apiKey: env.GEMINI_API_KEY } : {}),
      model: env.GEMINI_MODEL ?? "gemini-2.5-flash",
    }),
    openrouter: createOpenRouterProvider({
      ...(env.OPENROUTER_API_KEY ? { apiKey: env.OPENROUTER_API_KEY } : {}),
      ...(env.OPENROUTER_MODEL ? { model: env.OPENROUTER_MODEL } : {}),
      ...(env.APP_URL ? { siteUrl: env.APP_URL } : {}),
      appName: "Verity",
    }),
    cloudflare: createCloudflareProvider({
      ...(env.CLOUDFLARE_ACCOUNT_ID ? { accountId: env.CLOUDFLARE_ACCOUNT_ID } : {}),
      ...(env.CLOUDFLARE_API_TOKEN ? { apiToken: env.CLOUDFLARE_API_TOKEN } : {}),
      model: env.CLOUDFLARE_MODEL ?? "@cf/meta/llama-3.1-8b-instruct",
    }),
  }
  const order = (env.LLM_PROVIDER_ORDER ?? "gemini,openrouter,cloudflare")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter((name) => name in available)
  return order.map((name) => available[name] as LLMProvider)
}

export interface CreateEngineOptions {
  env: Env
  supabase?: SupabaseLike | null
  localEngine?: LocalEngine
  onGatewayEvent?: (event: GatewayEvent) => void
}

export interface CreatedEngine {
  engine: ReviewEngine
  gateway: ProviderGateway
  health: HealthRecorder
}

/**
 * Module-level cache so warm serverless instances reuse the in-memory tier.
 * The persistent tier (Supabase) survives cold starts.
 */
let sharedMemory: MemoryCache | null = null

export function createReviewEngine(options: CreateEngineOptions): CreatedEngine {
  const health = new HealthRecorder(options.supabase ?? null)
  const gateway = new ProviderGateway({
    providers: createProviders(options.env),
    onEvent: (event) => {
      health.handleEvent(event)
      options.onGatewayEvent?.(event)
    },
  })
  sharedMemory ??= new MemoryCache(500)
  const cache = new TieredCache(sharedMemory, options.supabase ? new SupabaseCache(options.supabase) : null)

  const engine = new ReviewEngine({
    gateway,
    cache,
    config: loadEngineConfig(options.env),
    ...(options.localEngine ? { localEngine: options.localEngine } : {}),
  })
  return { engine, gateway, health }
}
