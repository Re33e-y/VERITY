import { postJson } from "../http"
import { ProviderError, type GenerateInput, type GenerateResult, type LLMProvider } from "../types"
import { asArray, asNumber, asRecord, asString } from "../util"

export interface GeminiConfig {
  apiKey?: string
  model: string
  baseUrl?: string
}

export function createGeminiProvider(config: GeminiConfig): LLMProvider {
  const baseUrl = config.baseUrl ?? "https://generativelanguage.googleapis.com/v1beta"

  return {
    name: "gemini",
    defaultModel: config.model,
    isConfigured: () => Boolean(config.apiKey),

    async generate(input: GenerateInput): Promise<GenerateResult> {
      if (!config.apiKey) {
        throw new ProviderError("gemini", "not_configured", "GEMINI_API_KEY is not set")
      }
      const model = input.model ?? config.model
      const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent`

      const { data, latencyMs } = await postJson(
        "gemini",
        url,
        { "x-goog-api-key": config.apiKey },
        {
          systemInstruction: { parts: [{ text: input.system }] },
          contents: [{ role: "user", parts: [{ text: input.prompt }] }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 4096,
            ...(input.json ? { responseMimeType: "application/json" } : {}),
          },
        },
        input.timeoutMs
      )

      const root = asRecord(data)
      const candidate = asRecord(asArray(root?.candidates)[0])
      const parts = asArray(asRecord(candidate?.content)?.parts)
      const text = parts.map((part) => asString(asRecord(part)?.text) ?? "").join("")

      if (!text.trim()) {
        const reason =
          asString(candidate?.finishReason) ??
          asString(asRecord(root?.promptFeedback)?.blockReason) ??
          "empty response"
        throw new ProviderError("gemini", "bad_response", `Gemini returned no text (${reason})`)
      }

      const usage = asRecord(root?.usageMetadata)
      const inputTokens = asNumber(usage?.promptTokenCount)
      const outputTokens = asNumber(usage?.candidatesTokenCount)

      return {
        text,
        model,
        provider: "gemini",
        latencyMs,
        usage: {
          ...(inputTokens !== null ? { inputTokens } : {}),
          ...(outputTokens !== null ? { outputTokens } : {}),
        },
      }
    },
  }
}
