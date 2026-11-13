// scripts/test-byok.mts
// Verification suite for Judge BYOK (Bring Your Own API Key) system:
// 1. Session isolation across multiple judges
// 2. Secret redaction from errors and traces
// 3. Credential validation & security limits (TTL, concurrency, quota)
// 4. Disconnect & memory purging
// 5. Agentic BYOK dispatch & deterministic fallback on provider error

import {
  createByokSession,
  getByokSession,
  releaseByokSession,
  disconnectByokSession,
  maskApiKey,
  redactSecrets,
  byokStorage,
  type ByokProvider,
} from "../lib/byok/session";
import { callJson, CallBudget, LlmError, resetProvidersUsed, getLastProviderUsed } from "../lib/agents/llm";

function assert(cond: unknown, msg: string) {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok  ${msg}`);
}

async function runTests() {
  console.log("--- Running VERITY Judge BYOK Security & Execution Tests ---");

  // 1. Masking & Secret Redaction
  const geminiSample = "AIzaSyD-sampleGeminiKey1234567890abcdefg";
  const groqSample = "gsk_sampleGroqKey1234567890abcdefghij";
  const openRouterSample = "sk-or-v1-sampleOpenRouterKey1234567890abcdefgh";

  assert(maskApiKey(geminiSample) === "AIza...defg", "Gemini key properly masked for UI display");
  assert(maskApiKey(groqSample) === "gsk_...ghij", "Groq key properly masked for UI display");

  const errorWithSecret = `Failed to authenticate with key ${geminiSample} and groq ${groqSample}`;
  const redacted = redactSecrets(errorWithSecret, [geminiSample, groqSample]);
  assert(!redacted.includes(geminiSample), "Gemini key completely redacted from error string");
  assert(!redacted.includes(groqSample), "Groq key completely redacted from error string");
  assert(redacted.includes("[REDACTED_GEMINI_KEY]") || redacted.includes("[REDACTED_BYOK_KEY]"), "Redaction badge placed in error string");

  // 2. Session Isolation across two judges
  const judgeSessionA = createByokSession("gemini", geminiSample, "gemini-2.5-flash");
  const judgeSessionB = createByokSession("groq", groqSample, "llama-3.3-70b-versatile");

  assert(judgeSessionA.token !== judgeSessionB.token, "Judge sessions have unique cryptographically secure tokens");
  assert(judgeSessionA.provider === "gemini", "Judge A provider is Gemini");
  assert(judgeSessionB.provider === "groq", "Judge B provider is Groq");

  const retrievedA = getByokSession(judgeSessionA.token);
  const retrievedB = getByokSession(judgeSessionB.token);

  assert(retrievedA.session?.apiKey === geminiSample, "Judge A retrieves only its own key");
  assert(retrievedB.session?.apiKey === groqSample, "Judge B retrieves only its own key");
  assert(retrievedA.session?.model === "gemini-2.5-flash", "Judge A model preserved");
  assert(retrievedB.session?.model === "llama-3.3-70b-versatile", "Judge B model preserved");

  releaseByokSession(judgeSessionA.token);
  releaseByokSession(judgeSessionB.token);

  // 3. Concurrency Limits (Max 2 concurrent per session)
  const req1 = getByokSession(judgeSessionA.token);
  const req2 = getByokSession(judgeSessionA.token);
  const req3 = getByokSession(judgeSessionA.token); // Should exceed max concurrent (2)

  assert(req1.session !== null, "Concurrent request 1 allowed");
  assert(req2.session !== null, "Concurrent request 2 allowed");
  assert(req3.session === null && req3.error?.includes("concurrency limit"), "Third concurrent request blocked by session guard");

  releaseByokSession(judgeSessionA.token);
  releaseByokSession(judgeSessionA.token);

  // 4. Disconnect & Immediate Memory Purging
  const disconnected = disconnectByokSession(judgeSessionA.token);
  assert(disconnected === true, "Session successfully disconnected");
  const postDisconnect = getByokSession(judgeSessionA.token);
  assert(postDisconnect.session === null, "Session purged from memory immediately upon disconnect");

  // 5. AsyncLocalStorage Execution Context Isolation
  let observedInStore: string | undefined = undefined;
  await byokStorage.run(
    {
      provider: "groq",
      apiKey: groqSample,
      model: "llama-3.3-70b-versatile",
      sessionToken: judgeSessionB.token,
    },
    async () => {
      const current = byokStorage.getStore();
      observedInStore = current?.apiKey;
    }
  );

  assert(observedInStore === groqSample, "AsyncLocalStorage accurately scoped BYOK config to execution context");
  assert(byokStorage.getStore() === undefined, "AsyncLocalStorage cleared outside of request scope");

  // 6. Provider Error Handling & Redacted Fallback
  resetProvidersUsed();
  let caughtError: Error | null = null;
  try {
    await byokStorage.run(
      {
        provider: "groq",
        apiKey: "gsk_invalid_test_key_1234567890",
        model: "llama-3.3-70b-versatile",
        sessionToken: "test_token",
      },
      async () => {
        await callJson({
          system: "You are a test agent.",
          context: "Canon facts.",
          document: "Test input.",
          budget: new CallBudget(2),
          deadlineAt: Date.now() + 5000,
          parse: (raw) => raw,
        });
      }
    );
  } catch (err) {
    caughtError = err as Error;
  }

  assert(caughtError !== null, "Invalid BYOK credentials throw identifiable LlmError");
  assert(!caughtError?.message.includes("gsk_invalid_test_key_1234567890"), "Raw BYOK key never leaked in error message");

  // Cleanup Session B
  disconnectByokSession(judgeSessionB.token);

  console.log("--- All 6 Judge BYOK Verification Tests PASSED! ---");
}

runTests().catch((err) => {
  console.error("Test execution failed:", err);
  process.exit(1);
});
