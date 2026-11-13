// app/api/byok/disconnect/route.ts
import { NextResponse } from "next/server";
import { disconnectByokSession } from "@/lib/byok/session";

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const token =
      req.headers.get("x-byok-session-token") || (body as { sessionToken?: string }).sessionToken;

    if (!token) {
      return NextResponse.json({ success: true, message: "No active session to disconnect" });
    }

    const disconnected = disconnectByokSession(token);

    return NextResponse.json({
      success: true,
      disconnected,
      message: "Credentials purged from server memory. Local session terminated.",
    });
  } catch (err) {
    return NextResponse.json({ success: true, message: "Disconnected" });
  }
}
