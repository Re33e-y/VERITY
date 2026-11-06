export interface CacheEntry {
  payload: unknown
  provider: string
  model: string
}

export interface LlmCache {
  get(key: string): Promise<CacheEntry | null>
  set(key: string, kind: string, entry: CacheEntry, ttlSeconds: number): Promise<void>
}

/** Minimal slice of the Supabase client used here, so tests can fake it. */
export interface SupabaseLike {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any
}

export class MemoryCache implements LlmCache {
  private readonly store = new Map<string, { entry: CacheEntry; expiresAt: number }>()

  constructor(
    private readonly maxEntries = 500,
    private readonly now: () => number = Date.now
  ) {}

  async get(key: string): Promise<CacheEntry | null> {
    const hit = this.store.get(key)
    if (!hit) return null
    if (hit.expiresAt <= this.now()) {
      this.store.delete(key)
      return null
    }
    // Refresh recency so the oldest entry is evicted first.
    this.store.delete(key)
    this.store.set(key, hit)
    return hit.entry
  }

  async set(key: string, _kind: string, entry: CacheEntry, ttlSeconds: number): Promise<void> {
    this.store.delete(key)
    this.store.set(key, { entry, expiresAt: this.now() + ttlSeconds * 1000 })
    while (this.store.size > this.maxEntries) {
      const oldest = this.store.keys().next().value
      if (oldest === undefined) break
      this.store.delete(oldest)
    }
  }

  get size(): number {
    return this.store.size
  }
}

/** Persistent cache in Supabase. Every failure is swallowed: a cache must never break a review. */
export class SupabaseCache implements LlmCache {
  constructor(private readonly client: SupabaseLike) {}

  async get(key: string): Promise<CacheEntry | null> {
    try {
      const { data, error } = await this.client
        .from("llm_cache")
        .select("payload, provider, model, expires_at")
        .eq("cache_key", key)
        .maybeSingle()
      if (error || !data) return null
      if (Date.parse(String(data.expires_at)) <= Date.now()) return null
      return { payload: data.payload, provider: String(data.provider ?? ""), model: String(data.model ?? "") }
    } catch {
      return null
    }
  }

  async set(key: string, kind: string, entry: CacheEntry, ttlSeconds: number): Promise<void> {
    try {
      await this.client.from("llm_cache").upsert(
        {
          cache_key: key,
          kind,
          payload: entry.payload,
          provider: entry.provider,
          model: entry.model,
          expires_at: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
        },
        { onConflict: "cache_key" }
      )
    } catch {
      // ignore
    }
  }
}

/** Memory first, then the persistent store; a persistent hit warms memory. */
export class TieredCache implements LlmCache {
  constructor(
    private readonly fast: LlmCache,
    private readonly slow: LlmCache | null
  ) {}

  async get(key: string): Promise<CacheEntry | null> {
    const near = await this.fast.get(key)
    if (near) return near
    if (!this.slow) return null
    const far = await this.slow.get(key)
    if (far) await this.fast.set(key, "warm", far, 3600)
    return far
  }

  async set(key: string, kind: string, entry: CacheEntry, ttlSeconds: number): Promise<void> {
    await this.fast.set(key, kind, entry, ttlSeconds)
    if (this.slow) await this.slow.set(key, kind, entry, ttlSeconds)
  }
}
