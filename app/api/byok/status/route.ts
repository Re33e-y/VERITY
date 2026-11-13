// app/api/byok/status/route.ts
import { NextResponse } from "next/server";
import { getByokSession, releaseByokSession } from "@/lib/byok/session";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = req.headers.get("x-byok-session-token") || url.searchParams.get("token");

  if (!token) {
    return NextResponse.json({ active: false });
  }

  const { session, error } = getByokSession(token);
  if (!session) {
    return NextResponse.json({ active: false, error });
  }

  // Release the inFlight lock acquired in getByokSession
  releaseByokSession(token);

  return NextResponse.json({
    active: true,
    provider: session.provider,
    model: session.model,
    maskedKey: session.maskedKey,
    expiresAt: session.expiresAt,
    requestCount: session.requestCount,
    maxRequests: 30,
    remainingMinutes: Math.max(0, Math.round((session.expiresAt - Date.now()) / 60000)),
  });
}
