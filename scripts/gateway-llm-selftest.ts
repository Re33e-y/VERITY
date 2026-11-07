import { makeFallbackLLM, resetCooldowns } from "../lib/engine/gateway-llm"
import { createOpenRouterProvider } from "../lib/llm/providers/openrouter"

const env = {
  GEMINI_API_KEY: "g",
  OPENROUTER_API_KEY: "o",
  OPENROUTER_MODEL: "m:free",
  VERIFIER_MODEL: "",
}
const orFetch =
  (content: string, status = 200) =>
    (async (_input: RequestInfo | URL, _init?: RequestInit) => ({
      ok: status === 200,
      status,
      json: async () => ({ choices: [{ message: { content } }] }),
    })) as unknown as typeof fetch
const lim = { budgetMs: 400, attemptMs: 120, minMs: 20 }
let pass = 0
let fail = 0
const check = (name: string, cond: boolean, extra = "") => {
  if (cond) pass++
  else fail++
  console.log(`${cond ? "PASS" : "FAIL"} ${name} ${extra}`)
}

void (async () => {
  // 1 normal: gemini judge, openrouter verifier (independent)
  resetCooldowns()
  let g = 0
  let a = makeFallbackLLM({
    env,
    gemini: async () => {
      g++
      return { items: [] }
    },
    fetchFn: orFetch('{"items":[{"id":0,"relation":"contradicts"}]}'),
    ...lim,
  })
  await a.llm("s", "u", "judge")
  const v = await a.llm("s", "u", "verifier")
  check("1 judge=gemini, verifier=openrouter", a.used().join() === "gemini/judge,openrouter/verifier", a.used().join())
  check(
    "1 verifier JSON parsed",
    (v as { items?: { relation?: string }[] }).items?.[0]?.relation === "contradicts"
  )

  // 2 gemini 429 -> openrouter serves; cooldown makes the next call skip gemini
  resetCooldowns()
  g = 0
  a = makeFallbackLLM({
    env,
    gemini: async () => {
      g++
      throw new Error("Gemini request failed (429): quota")
    },
    fetchFn: (async (_input: RequestInfo | URL, init?: RequestInit) => {
      const request = JSON.parse(String(init?.body)) as {
        provider?: { data_collection?: string; zdr?: boolean }
      }
      check(
        "2 fallback requires data denial and ZDR",
        request.provider?.data_collection === "deny" && request.provider.zdr === true
      )
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "```json\n{\"items\":[]}\n```" } }] }),
      }
    }) as typeof fetch,
    ...lim,
  })
  await a.llm("s", "u", "judge")
  check("2 fallback served judge", a.used().join() === "openrouter/judge", a.used().join())
  const b = makeFallbackLLM({
    env,
    gemini: async () => {
      g++
      return {}
    },
    fetchFn: orFetch('{"items":[]}'),
    ...lim,
  })
  await b.llm("s", "u", "judge")
  check("2 gemini skipped during cooldown", g === 1, `gemini calls=${g}`)

  // 3 both fail -> error with statuses only, no body/keys
  resetCooldowns()
  a = makeFallbackLLM({
    env,
    gemini: async () => {
      throw new Error("Gemini request failed (503): secret-body")
    },
    fetchFn: orFetch("", 429),
    ...lim,
  })
  let msg = ""
  try {
    await a.llm("s", "u", "judge")
  } catch (error) {
    msg = error instanceof Error ? error.message : String(error)
  }
  check("3 both failed -> throws", msg.startsWith("No LLM provider succeeded"), msg)
  check("3 error leaks no body or key", !/secret-body|Bearer|"o"/.test(msg))

  // 4 openrouter not configured -> gemini only, single attempt
  resetCooldowns()
  g = 0
  a = makeFallbackLLM({
    env: { GEMINI_API_KEY: "g" },
    gemini: async () => {
      g++
      throw new Error("Gemini request failed (500)")
    },
    ...lim,
  })
  try {
    await a.llm("s", "u", "judge")
  } catch {}
  check("4 no fallback configured -> 1 attempt", g === 1, `attempts=${g}`)

  // 5 gemini hangs -> timeout -> openrouter
  resetCooldowns()
  a = makeFallbackLLM({
    env,
    gemini: () => new Promise(() => {}),
    fetchFn: orFetch('{"items":[]}'),
    ...lim,
  })
  await a.llm("s", "u", "judge")
  check("5 timeout falls back", a.used().join() === "openrouter/judge", a.used().join())

  // 6 judge served by openrouter -> verifier prefers gemini
  resetCooldowns()
  let first = true
  a = makeFallbackLLM({
    env,
    gemini: async () => {
      if (first) {
        first = false
        throw new Error("(500)")
      }
      return { items: [] }
    },
    fetchFn: orFetch('{"items":[]}'),
    ...lim,
  })
  await a.llm("s", "u", "judge")
  resetCooldowns()
  await a.llm("s", "u", "verifier")
  check("6 verifier avoids judge provider", a.used().join() === "openrouter/judge,gemini/verifier", a.used().join())

  // 7 unparseable output counts as failure
  resetCooldowns()
  a = makeFallbackLLM({
    env: {
      GEMINI_API_KEY: "g",
      OPENROUTER_API_KEY: "o",
      OPENROUTER_MODEL: "m",
    },
    gemini: async () => {
      throw new Error("(429)")
    },
    fetchFn: orFetch("not json at all"),
    ...lim,
  })
  msg = ""
  try {
    await a.llm("s", "u", "judge")
  } catch (error) {
    msg = error instanceof Error ? error.message : String(error)
  }
  check("7 garbage output -> error", msg.startsWith("No LLM provider succeeded"), msg)

  // 8 v2 provider applies the same OpenRouter data restrictions
  const originalFetch = globalThis.fetch
  const v2Request: { provider?: { data_collection?: string; zdr?: boolean } } = {}
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    Object.assign(v2Request, JSON.parse(String(init?.body)))
    return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    })
  }) as typeof fetch
  try {
    await createOpenRouterProvider({ apiKey: "test-key", model: "test/model" }).generate({
      system: "test",
      prompt: "test",
      timeoutMs: 1000,
      json: true,
    })
    check(
      "8 v2 provider requires data denial and ZDR",
      v2Request?.provider?.data_collection === "deny" && v2Request?.provider?.zdr === true
    )
  } catch {
    check("8 v2 provider requires data denial and ZDR", false)
  } finally {
    globalThis.fetch = originalFetch
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exitCode = 1
})()
