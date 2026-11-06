import type { GatewayEvent } from "../llm/gateway"
import type { SupabaseLike } from "./cache"

export interface HealthRow {
  provider: string
  model: string | null
  ok: boolean
  error_kind: string | null
  status: number | null
  latency_ms: number | null
}

/**
 * Buffers provider attempts and writes them in one insert. Call flush() before
 * the response is returned (or inside Next's after()), because un-awaited work
 * can be frozen when a serverless function finishes.
 */
export class HealthRecorder {
  private buffer: HealthRow[] = []

  constructor(
    private readonly client: SupabaseLike | null,
    private readonly maxBuffer = 100
  ) {}

  handleEvent = (event: GatewayEvent): void => {
    if (event.type !== "attempt_ok" && event.type !== "attempt_failed") return
    if (this.buffer.length >= this.maxBuffer) this.buffer.shift()
    this.buffer.push({
      provider: event.provider,
      model: event.model ?? null,
      ok: event.type === "attempt_ok",
      error_kind: event.kind ?? null,
      status: event.status ?? null,
      latency_ms: event.latencyMs ?? null,
    })
  }

  pending(): number {
    return this.buffer.length
  }

  async flush(): Promise<void> {
    if (!this.client || this.buffer.length === 0) {
      this.buffer = []
      return
    }
    const rows = this.buffer
    this.buffer = []
    try {
      await this.client.from("provider_health").insert(rows)
    } catch {
      // Health reporting is best effort.
    }
  }
}
