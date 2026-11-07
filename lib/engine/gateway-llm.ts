/**
 * Bounded provider fallback for the router's LLM calls: Gemini first, OpenRouter second.
 *
 * Guarantees (all enforced here, not by convention):
 *   - at most 2 provider attempts per logical call, one attempt each (no retry loops)
 *   - hard time budget per logical call, below the router's own 20 s timeout
 *   - a provider that fails is skipped for a cooldown (quota 5 min, bad key/model 30 min, other 1 min)
 *   - the verifier prefers the provider that did NOT serve the judge, so it is independent when possible
 *   - OpenRouter is used only when both its key and model are configured
 *   - errors carry status codes only, never response bodies, prompts or keys
 */
import { callGemini } from "./gemini"
import type { LLM } from "./router"

type Role = "judge" | "verifier"
type Provider = "gemini" | "openrouter"

const OPENROUTER_KEY_VAR = "OPENROUTER_API_KEY"
const OPENROUTER_MODEL_VAR = "OPENROUTER_MODEL"

export interface Deps {
  gemini: (system: string, user: string, model?: string) => Promise<unknown>
  fetchFn: typeof fetch
  env: Record<string, string | undefined>
  now: () => number
  budgetMs: number
  attemptMs: number
  minMs: number
}

const cooldownUntil: Record<Provider, number> = { gemini: 0, openrouter: 0 }

export const resetCooldowns = () => {
  cooldownUntil.gemini = 0
  cooldownUntil.openrouter = 0
}

const statusOf = (error: unknown): number | null => {
  const message = String((error as Error)?.message ?? error).match(/\b([45]\d\d)\b/)
  return message ? Number(message[1]) : null
}

const cooldownFor = (error: unknown): number => {
  const status = statusOf(error)
  if (status === 429) return 5 * 60_000
  if (status === 401 || status === 403 || status === 404) return 30 * 60_000
  return 60_000
}

function parseJson(text: string): unknown {
  const clean = text.replace(/```json|```/g, "").trim()
  try {
    return JSON.parse(clean)
  } catch {
    const start = clean.indexOf("{")
    const end = clean.lastIndexOf("}")
    if (start >= 0 && end > start) return JSON.parse(clean.slice(start, end + 1))
    throw new Error("Provider returned unparseable JSON")
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Provider call timed out")), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function callOpenRouter(
  deps: Deps,
  system: string,
  user: string,
  ms: number
): Promise<unknown> {
  const key = deps.env[OPENROUTER_KEY_VAR]
  const model = deps.env[OPENROUTER_MODEL_VAR]
  if (!key || !model) throw new Error("OpenRouter not configured")

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), ms)
  try {
    const response = await deps.fetchFn("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${key}`,
        "X-Title": "VERITY",
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        provider: { data_collection: "deny", zdr: true },
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`OpenRouter request failed (${response.status})`)
    const data = (await response.json()) as {
      choices?: { message?: { content?: string } }[]
    }
    return parseJson(data.choices?.[0]?.message?.content ?? "")
  } finally {
    clearTimeout(timer)
  }
}

/** Create one per request. `used()` lists which provider served each call, for the review snapshot. */
export function makeFallbackLLM(overrides: Partial<Deps> = {}) {
  const deps: Deps = {
    gemini: callGemini,
    fetchFn: fetch,
    env: process.env,
    now: Date.now,
    budgetMs: 19_000,
    attemptMs: 14_000,
    minMs: 1_500,
    ...overrides,
  }
  const used: string[] = []
  let judgeProvider: Provider | null = null

  const configured = (provider: Provider) =>
    provider === "gemini"
      ? Boolean(deps.env.GEMINI_API_KEY)
      : Boolean(deps.env[OPENROUTER_KEY_VAR] && deps.env[OPENROUTER_MODEL_VAR])

  const order = (role: Role): Provider[] => {
    const preferOther = role === "verifier" && judgeProvider !== null
    const base: Provider[] =
      preferOther && judgeProvider === "gemini"
        ? ["openrouter", "gemini"]
        : ["gemini", "openrouter"]
    const ordered: Provider[] =
      preferOther && judgeProvider === "openrouter" ? ["gemini", "openrouter"] : base
    return ordered.filter(
      (provider) => configured(provider) && deps.now() >= cooldownUntil[provider]
    )
  }

  const llm: LLM = async (system, user, role) => {
    const start = deps.now()
    const errors: string[] = []
    let attempts = 0
    for (const provider of order(role)) {
      if (attempts >= 2) break
      const remaining = deps.budgetMs - (deps.now() - start)
      if (remaining < deps.minMs) break
      attempts++
      const timeoutMs = Math.min(deps.attemptMs, remaining)
      try {
        const output =
          provider === "gemini"
            ? await withTimeout(
                deps.gemini(
                  system,
                  user,
                  role === "verifier" ? deps.env.VERIFIER_MODEL : undefined
                ),
                timeoutMs
              )
            : await callOpenRouter(deps, system, user, timeoutMs)
        if (role === "judge") judgeProvider = provider
        used.push(`${provider}/${role}`)
        return output
      } catch (error) {
        cooldownUntil[provider] = deps.now() + cooldownFor(error)
        errors.push(`${provider}: ${statusOf(error) ?? "error"}`)
      }
    }
    throw new Error(`No LLM provider succeeded (${errors.join(", ") || "none available"})`)
  }

  return { llm, used: () => [...used] }
}
