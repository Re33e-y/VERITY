function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function getRetryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after")

  if (retryAfter) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds) && seconds >= 0) {
      return Math.min(seconds * 1000, 30_000)
    }

    const date = Date.parse(retryAfter)
    if (Number.isFinite(date)) {
      return Math.min(Math.max(date - Date.now(), 0), 30_000)
    }
  }

  return Math.min(1000 * 2 ** attempt, 8000)
}

async function requestWithRetry(
  url: string,
  headers: Record<string, string>,
  body: unknown
): Promise<unknown> {
  const maxAttempts = 3

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    })

    if (response.ok) {
      return response.json()
    }

    const details = await response.text()

    if (
      (response.status === 429 || response.status >= 500) &&
      attempt < maxAttempts - 1
    ) {
      await new Promise((resolve) =>
        setTimeout(resolve, getRetryDelay(response, attempt))
      )
      continue
    }

    throw new Error(
      `AI request failed (${response.status}): ${details.slice(0, 1000)}`
    )
  }

  throw new Error("AI request failed after retries.")
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error("AI returned an invalid response.")
  }

  const text = typeof value.text === "string" ? value.text : undefined
  if (!text) {
    throw new Error("AI returned empty generated content.")
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(
      text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
    )
  } catch {
    throw new Error("AI returned invalid JSON.")
  }

  if (!isRecord(parsed)) {
    throw new Error("AI response must be a JSON object.")
  }

  return parsed
}

async function callGeminiProvider(
  system: string,
  user: string,
  model?: string
): Promise<Record<string, unknown>> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error("GEMINI_API_KEY is not configured.")

  const selectedModel =
    model ?? process.env.GEMINI_MODEL ?? "gemini-2.5-flash"
  const payload = await requestWithRetry(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(selectedModel)}:generateContent`,
    {
      "Content-Type": "application/json",
      "x-goog-api-key": key,
    },
    {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }
  )

  if (!isRecord(payload) || !Array.isArray(payload.candidates)) {
    throw new Error("Gemini returned an invalid response.")
  }

  const candidate = payload.candidates[0]
  if (!isRecord(candidate) || !isRecord(candidate.content)) {
    throw new Error("Gemini returned no generated content.")
  }

  const parts = candidate.content.parts
  if (!Array.isArray(parts)) {
    throw new Error("Gemini returned no response parts.")
  }

  const text = parts
    .filter(isRecord)
    .map((part) => (typeof part.text === "string" ? part.text : ""))
    .join("")
    .trim()

  return parseJsonObject({ text })
}

export async function callGemini(
  system: string,
  user: string,
  model?: string
): Promise<Record<string, unknown>> {
  return callGeminiProvider(system, user, model)
}
