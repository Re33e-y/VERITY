import { createProviders } from "../lib/review/env"

async function main() {
  const provider = createProviders(process.env)
    .find((p) => p.name === "openrouter")

  if (!provider || !provider.isConfigured()) {
    throw new Error("OpenRouter is not configured")
  }

  console.log("Provider configured:", provider.name)

  const result = await provider.generate({
    system: "You are a JSON response test.",
    prompt: 'Return a JSON object with {"status":"ok","provider":"recursive-flint"}.',
    json: true,
    timeoutMs: 20000,
  })

  console.log("Model:", result.model)
  console.log("Provider:", result.provider)
  console.log("Response:", JSON.stringify(JSON.parse(result.text)))
  console.log("Latency:", result.latencyMs, "ms")
}

main().catch((error) => {
  console.error("OpenRouter test failed:", error.message)
  process.exitCode = 1
})
