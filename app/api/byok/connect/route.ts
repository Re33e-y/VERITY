// app/api/byok/connect/route.ts
import { NextResponse } from "next/server";
import {
  createByokSession,
  validateProviderCredentials,
  redactSecrets,
  type ByokProvider,
} from "@/lib/byok/session";

const ALLOWED_PROVIDERS: ByokProvider[] = ["gemini", "groq", "openrouter"];

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { provider, apiKey, model } = body as {
      provider?: string;
      apiKey?: string;
      model?: string;
    };

    if (!provider || !ALLOWED_PROVIDERS.includes(provider as ByokProvider)) {
      return NextResponse.json(
        { error: "Invalid provider. Supported: gemini, groq, openrouter." },
        { status: 400 }
      );
    }

    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length < 8) {
      return NextResponse.json(
        { error: "Valid API key is required (minimum 8 characters)." },
        { status: 400 }
      );
    }

    // Validate credentials with minimal test request
    const validation = await validateProviderCredentials(
      provider as ByokProvider,
      apiKey,
      model
    );

    if (!validation.ok) {
      return NextResponse.json(
        {
          error: redactSecrets(validation.error || "Authentication failed with provider", [apiKey]),
          provider,
        },
        { status: 401 }
      );
    }

    // Create session in volatile memory with 15m TTL
    const session = createByokSession(provider as ByokProvider, apiKey, validation.modelUsed);

    return NextResponse.json({
      success: true,
      sessionToken: session.token,
      provider: session.provider,
      model: session.model,
      maskedKey: session.maskedKey,
      expiresAt: session.expiresAt,
      ttlMinutes: 15,
      message: `Successfully connected to ${session.provider} (${session.model}). Credentials held in server memory.`,
    });
  } catch (err) {
    const msg = (err as Error)?.message || "Internal connection error";
    return NextResponse.json({ error: redactSecrets(msg) }, { status: 500 });
  }
}
