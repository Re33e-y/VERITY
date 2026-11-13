// lib/byok/session.ts
// Secure server-side in-memory session store for Judge BYOK (Bring Your Own API Key).
// INVARIANTS:
// 1. Raw API keys are NEVER persisted to database, disk, or logs.
// 2. Credentials reside strictly in server memory with a 15-minute inactivity TTL.
// 3. Secrets are redacted from all exceptions, error messages, and telemetry.
// 4. Concurrency is limited to 2 in-flight requests per session; max 30 requests total.

import { randomBytes } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

export type ByokProvider = "gemini" | "groq" | "openrouter";

export interface ByokSession {
  token: string;
  provider: ByokProvider;
  apiKey: string;
  model: string;
  createdAt: number;
  expiresAt: number;
  lastActiveAt: number;
  requestCount: number;
  inFlight: number;
  maskedKey: string;
}

export interface ByokConfig {
  provider: ByokProvider;
  apiKey: string;
  model: string;
  sessionToken: string;
}

/**
 * Request-scoped storage so concurrent judge reviews never share or bleed credentials.
 */
export const byokStorage = new AsyncLocalStorage<ByokConfig | undefined>();

const SESSION_TTL_MS = 15 * 60 * 1000; // 15 minutes inactivity TTL
const SESSION_MAX_LIFETIME_MS = 30 * 60 * 1000; // 30 minutes hard ceiling
const MAX_REQUESTS_PER_SESSION = 30;
const MAX_CONCURRENT_PER_SESSION = 2;

// In-memory isolated session store
const sessions = new Map<string, ByokSession>();

/**
 * Mask an API key for safe display (e.g. "AIza...1234" or "gsk_...9a2b").
 */
export function maskApiKey(key: string): string {
  if (!key) return "";
  const trimmed = key.trim();
  if (trimmed.length <= 8) return "••••••••";
  const start = trimmed.slice(0, 4);
  const end = trimmed.slice(-4);
  return `${start}...${end}`;
}

/**
 * Redact secrets from text or error messages.
 */
export function redactSecrets(text: string, extraSecrets: string[] = []): string {
  if (!text) return "";
  let sanitized = text;

  // Redact known active keys
  for (const secret of extraSecrets) {
    if (secret && secret.length >= 4) {
      sanitized = sanitized.replaceAll(secret, "[REDACTED_BYOK_KEY]");
    }
  }

  // Redact all active session keys from memory
  for (const session of sessions.values()) {
    if (session.apiKey && session.apiKey.length >= 4) {
      sanitized = sanitized.replaceAll(session.apiKey, "[REDACTED_BYOK_KEY]");
    }
  }

  // Redact common API key patterns (Google AIza..., Groq gsk_..., OpenRouter sk-or-...)
  sanitized = sanitized.replace(/\bAIza[0-9A-Za-z-_]{30,}\b/g, "[REDACTED_GEMINI_KEY]");
  sanitized = sanitized.replace(/\bgsk_[0-9A-Za-z]{30,}\b/g, "[REDACTED_GROQ_KEY]");
  sanitized = sanitized.replace(/\bsk-or-[0-9A-Za-z-_]{30,}\b/g, "[REDACTED_OPENROUTER_KEY]");

  return sanitized;
}

/**
 * Remove expired sessions periodically.
 */
function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now > session.expiresAt || now - session.createdAt > SESSION_MAX_LIFETIME_MS) {
      // Overwrite key in memory before deletion
      session.apiKey = "";
      sessions.delete(token);
    }
  }
}

/**
 * Create a new isolated judge BYOK session in server memory.
 */
export function createByokSession(
  provider: ByokProvider,
  apiKey: string,
  model?: string
): { token: string; expiresAt: number; maskedKey: string; model: string; provider: ByokProvider } {
  cleanupExpiredSessions();

  const token = `byok_sess_${randomBytes(24).toString("hex")}`;
  const now = Date.now();
  const expiresAt = now + SESSION_TTL_MS;
  const sanitizedKey = apiKey.trim();

  const defaultModels: Record<ByokProvider, string> = {
    gemini: "gemini-2.5-flash",
    groq: "llama-3.3-70b-versatile",
    openrouter: "google/gemini-2.5-flash",
  };

  const selectedModel = model?.trim() || defaultModels[provider];

  const session: ByokSession = {
    token,
    provider,
    apiKey: sanitizedKey,
    model: selectedModel,
    createdAt: now,
    expiresAt,
    lastActiveAt: now,
    requestCount: 0,
    inFlight: 0,
    maskedKey: maskApiKey(sanitizedKey),
  };

  sessions.set(token, session);

  return {
    token,
    expiresAt,
    maskedKey: session.maskedKey,
    model: session.model,
    provider: session.provider,
  };
}

/**
 * Retrieve an active session, enforcing TTL, request limits, and concurrency caps.
 */
export function getByokSession(token: string): { session: ByokSession | null; error?: string } {
  cleanupExpiredSessions();

  const session = sessions.get(token);
  if (!session) {
    return { session: null, error: "BYOK session not found or expired" };
  }

  const now = Date.now();
  if (now > session.expiresAt) {
    session.apiKey = "";
    sessions.delete(token);
    return { session: null, error: "BYOK session has expired" };
  }

  if (session.requestCount >= MAX_REQUESTS_PER_SESSION) {
    return { session: null, error: "BYOK session request limit reached (max 30 reviews)" };
  }

  if (session.inFlight >= MAX_CONCURRENT_PER_SESSION) {
    return { session: null, error: "BYOK session concurrency limit exceeded (max 2 parallel reviews)" };
  }

  // Extend sliding expiry
  session.lastActiveAt = now;
  session.expiresAt = Math.min(now + SESSION_TTL_MS, session.createdAt + SESSION_MAX_LIFETIME_MS);
  session.requestCount += 1;
  session.inFlight += 1;

  return { session };
}

/**
 * Release in-flight lock after request finishes.
 */
export function releaseByokSession(token: string): void {
  const session = sessions.get(token);
  if (session && session.inFlight > 0) {
    session.inFlight -= 1;
  }
}

/**
 * Disconnect and purge a judge session.
 */
export function disconnectByokSession(token: string): boolean {
  const session = sessions.get(token);
  if (session) {
    session.apiKey = ""; // wipe memory
    sessions.delete(token);
    return true;
  }
  return false;
}

/**
 * Validate provider credentials with a minimal non-leaking test request.
 */
export async function validateProviderCredentials(
  provider: ByokProvider,
  apiKey: string,
  model?: string
): Promise<{ ok: boolean; error?: string; modelUsed: string }> {
  const key = apiKey.trim();
  if (!key) return { ok: false, error: "API key cannot be empty", modelUsed: "" };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000); // 8 second timeout

  try {
    if (provider === "gemini") {
      const targetModel = model || "gemini-2.5-flash";
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${targetModel}:generateContent`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: "ping" }] }],
            generationConfig: { maxOutputTokens: 2, temperature: 0 },
          }),
          signal: ctrl.signal,
        }
      );

      if (res.status === 400) {
        const text = await res.text();
        if (text.includes("API_KEY_INVALID")) {
          return { ok: false, error: "Invalid Google Gemini API key", modelUsed: targetModel };
        }
        return { ok: false, error: `Gemini rejected request: HTTP 400`, modelUsed: targetModel };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Invalid or unauthorized Google Gemini API key", modelUsed: targetModel };
      }
      if (res.status === 429) {
        return { ok: false, error: "Google Gemini quota exhausted or rate limited (HTTP 429)", modelUsed: targetModel };
      }
      if (!res.ok) {
        return { ok: false, error: `Google Gemini error: HTTP ${res.status}`, modelUsed: targetModel };
      }

      return { ok: true, modelUsed: targetModel };
    }

    if (provider === "groq") {
      const targetModel = model || "llama-3.3-70b-versatile";
      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: targetModel,
          messages: [{ role: "user", content: "ping" }],
          max_tokens: 2,
        }),
        signal: ctrl.signal,
      });

      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Invalid or unauthorized Groq API key", modelUsed: targetModel };
      }
      if (res.status === 429) {
        return { ok: false, error: "Groq rate limit or quota exceeded (HTTP 429)", modelUsed: targetModel };
      }
      if (!res.ok) {
        return { ok: false, error: `Groq error: HTTP ${res.status}`, modelUsed: targetModel };
      }

      return { ok: true, modelUsed: targetModel };
    }

    if (provider === "openrouter") {
      const targetModel = model || "google/gemini-2.5-flash";
      const res = await fetch("https://openrouter.ai/api/v1/auth/key", {
        method: "GET",
        headers: {
          Authorization: `Bearer ${key}`,
        },
        signal: ctrl.signal,
      });

      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: "Invalid or unauthorized OpenRouter API key", modelUsed: targetModel };
      }
      if (res.status === 429) {
        return { ok: false, error: "OpenRouter rate limited (HTTP 429)", modelUsed: targetModel };
      }
      if (!res.ok) {
        return { ok: false, error: `OpenRouter error: HTTP ${res.status}`, modelUsed: targetModel };
      }

      return { ok: true, modelUsed: targetModel };
    }

    return { ok: false, error: `Unsupported provider: ${provider}`, modelUsed: "" };
  } catch (err) {
    const isTimeout = (err as Error)?.name === "AbortError";
    return {
      ok: false,
      error: isTimeout ? "Validation request timed out (8s)" : `Connection failed: ${(err as Error)?.message}`,
      modelUsed: model || "",
    };
  } finally {
    clearTimeout(timer);
  }
}
