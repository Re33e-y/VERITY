import { postJson } from "../http"
import {
  ProviderError,
  classifyStatus,
  type GenerateInput,
  type GenerateResult,
  type LLMProvider,
} from "../types"
import { asArray, asNumber, asRecord, asString } from "../util"

export interface OpenRouterConfig {
  apiKey?: string
  /** No default on purpose: free-tier model availability changes often. */
  model?: string
  baseUrl?: string
  siteUrl?: string
  appName?: string
}

export function createOpenRouterProvider(config: OpenRouterConfig): LLMProvider {
  const baseUrl = config.baseUrl ?? "https://openrouter.ai/api/v1"

  return {
    name: "openrouter",
    defaultModel: config.model ?? "",
    isConfigured: () => Boolean(config.apiKey && config.model),

    async generate(input: GenerateInput): Promise<GenerateResult> {
      const model = input.model ?? config.model
      if (!config.apiKey || !model) {
        throw new ProviderError(
          "openrouter",
          "not_configured",
          "OPENROUTER_API_KEY and OPENROUTER_MODEL must both be set"
        )
      }

      const { data, latencyMs } = await postJson(
        "openrouter",
        `${baseUrl}/chat/completions`,
        {
          Authorization: `Bearer ${config.apiKey}`,
          ...(config.siteUrl ? { "HTTP-Referer": config.siteUrl } : {}),
          ...(config.appName ? { "X-Title": config.appName } : {}),
        },
        {
          model,
          temperature: 0,
          max_tokens: 2048,
          provider: { data_collection: "deny", zdr: true },
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.prompt },
          ],
          ...(input.json ? { response_format: { type: "json_object" } } : {}),
        },
        input.timeoutMs
      )

      const root = asRecord(data)

      // OpenRouter can answer HTTP 200 with an error object in the body.
      const bodyError = asRecord(root?.error)
      if (bodyError) {
        const code = asNumber(bodyError.code) ?? 502
        throw new ProviderError(
          "openrouter",
          classifyStatus(code),
          `openrouter ${code}: ${asString(bodyError.message) ?? "provider error"}`,
          { status: code }
        )
      }

      const message = asRecord(asRecord(asArray(root?.choices)[0])?.message)
      const text = asString(message?.content)
      if (!text || !text.trim()) {
        throw new ProviderError("openrouter", "bad_response", "OpenRouter returned no message content")
      }

      const usage = asRecord(root?.usage)
      const inputTokens = asNumber(usage?.prompt_tokens)
      const outputTokens = asNumber(usage?.completion_tokens)

      return {
        text,
        model: asString(root?.model) ?? model,
        provider: "openrouter",
        latencyMs,
        usage: {
          ...(inputTokens !== null ? { inputTokens } : {}),
          ...(outputTokens !== null ? { outputTokens } : {}),
        },
      }
    },
  }
}
