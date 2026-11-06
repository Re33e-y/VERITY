import { createProviders } from "../lib/review/env"
import { ProviderGateway } from "../lib/llm/gateway"
import { ProviderError, type LLMProvider } from "../lib/llm/types"

async function main() {
  const providers = createProviders(process.env)
  const openrouter = providers.find(p => p.name === "openrouter")

  if (!openrouter?.isConfigured()) {
    throw new Error("OpenRouter is not configured")
  }

  const simulatedGeminiFailure: LLMProvider = {
    name: "gemini",
    defaultModel: "gemini-2.5-flash",
    isConfigured: () => true,
    async generate() {
      console.log("Simulating Gemini authentication failure...")
      throw new ProviderError("gemini", "auth", "Simulated 401", {
        status: 401
      })
    }
  }

  const gateway = new ProviderGateway({
    providers: [simulatedGeminiFailure, openrouter]
  })

  const result = await gateway.generate({
    system: "Return valid JSON only.",
    prompt: 'Return {"status":"fallback_success"}',
    json: true
  })

  console.log("\nGateway result:")
  console.log("Provider:", result.provider)
  console.log("Model:", result.model)
  console.log("Response:", JSON.stringify(JSON.parse(result.text)))
  console.log("Attempts:", result.attempts)
}

main().catch(error => {
  console.error("Gateway test failed:", error.message)
  process.exitCode = 1
})
