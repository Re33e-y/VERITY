import { ProviderError, classifyStatus } from "./types"
import { asRecord, asString, truncate } from "./util"

/**
 * POST JSON with a hard timeout and typed errors. Secrets travel in headers
 * only, and error messages never echo request headers.
 */
export async function postJson(
  provider: string,
  url: string,
  headers: Record<string, string>,
  body: unknown,
  timeoutMs: number
): Promise<{ data: unknown; latencyMs: number }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const started = Date.now()

  try {
    let response: Response
    try {
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
    } catch (error) {
      if (controller.signal.aborted) {
        throw new ProviderError(provider, "timeout", `${provider} timed out after ${timeoutMs}ms`)
      }
      throw new ProviderError(
        provider,
        "network",
        `${provider} network error: ${error instanceof Error ? error.message : "unknown"}`
      )
    }

    let raw: string
    try {
      raw = await response.text()
    } catch {
      throw new ProviderError(
        provider,
        controller.signal.aborted ? "timeout" : "network",
        `${provider} response body could not be read`
      )
    }

    let data: unknown = null
    try {
      data = raw ? JSON.parse(raw) : null
    } catch {
      data = null
    }

    if (!response.ok) {
      const errorObject = asRecord(asRecord(data)?.error)
      const providerMessage =
        asString(errorObject?.message) ?? asString(asRecord(data)?.message) ?? truncate(raw, 200)
      const retryAfterSeconds = Number(response.headers.get("retry-after"))
      throw new ProviderError(
        provider,
        classifyStatus(response.status),
        `${provider} ${response.status}: ${truncate(providerMessage, 240)}`,
        {
          status: response.status,
          retryAfterMs:
            Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0
              ? retryAfterSeconds * 1000
              : null,
        }
      )
    }

    return { data, latencyMs: Date.now() - started }
  } finally {
    clearTimeout(timer)
  }
}
