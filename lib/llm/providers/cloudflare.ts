import { postJson } from "../http"
import { ProviderError, type GenerateInput, type GenerateResult, type LLMProvider } from "../types"
import { asArray, asRecord, asString } from "../util"

export interface CloudflareConfig {
  accountId?: string
  apiToken?: string
  model: string
  baseUrl?: string
}

export function createCloudflareProvider(config: CloudflareConfig): LLMProvider {
  const baseUrl = config.baseUrl ?? "https://api.cloudflare.com/client/v4"

  return {
    name: "cloudflare",
    defaultModel: config.model,
    isConfigured: () => Boolean(config.accountId && config.apiToken),

    async generate(input: GenerateInput): Promise<GenerateResult> {
      if (!config.accountId || !config.apiToken) {
        throw new ProviderError(
          "cloudflare",
          "not_configured",
          "CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must both be set"
        )
      }
      const model = input.model ?? config.model

      const { data, latencyMs } = await postJson(
        "cloudflare",
        `${baseUrl}/accounts/${encodeURIComponent(config.accountId)}/ai/run/${model}`,
        { Authorization: `Bearer ${config.apiToken}` },
        {
          temperature: 0,
          max_tokens: 2048,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.prompt },
          ],
        },
        input.timeoutMs
      )

      const root = asRecord(data)
      if (root?.success === false) {
        const first = asRecord(asArray(root.errors)[0])
        throw new ProviderError(
          "cloudflare",
          "server",
          `cloudflare error: ${asString(first?.message) ?? "unknown"}`
        )
      }

      const response = asRecord(root?.result)?.response
      const text =
        typeof response === "string"
          ? response
          : response !== undefined && response !== null
            ? JSON.stringify(response)
            : null

      if (!text || !text.trim()) {
        throw new ProviderError("cloudflare", "bad_response", "Cloudflare returned no text")
      }
      return { text, model, provider: "cloudflare", latencyMs }
    },
  }
}
