export const ALLOWED_DECISIONS = ["accepted", "dismissed", "overridden"] as const
export type DecisionValue = (typeof ALLOWED_DECISIONS)[number]

export const MIN_REASON_LENGTH = 5
export const MAX_REASON_LENGTH = 1000

export type ValidDecision = {
  finding_id: string
  decision: DecisionValue
  reason: string
  decided_by?: string
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export function validateDecision(
  input: unknown
): { ok: true; value: ValidDecision } | { ok: false; error: string } {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, error: "Request body must be a JSON object" }
  }
  const body = input as Record<string, unknown>

  const findingId =
    typeof body.finding_id === "string" ? body.finding_id.trim() : ""
  if (!UUID_PATTERN.test(findingId)) {
    return { ok: false, error: "A valid finding_id is required." }
  }

  const decision =
    typeof body.decision === "string" ? body.decision.trim().toLowerCase() : ""
  if (!(ALLOWED_DECISIONS as readonly string[]).includes(decision)) {
    return {
      ok: false,
      error: `decision must be one of: ${ALLOWED_DECISIONS.join(", ")}`,
    }
  }

  const reason = typeof body.reason === "string" ? body.reason.trim() : ""
  if (reason.length < MIN_REASON_LENGTH) {
    return {
      ok: false,
      error: `A reason of at least ${MIN_REASON_LENGTH} characters is required`,
    }
  }
  if (reason.length > MAX_REASON_LENGTH) {
    return {
      ok: false,
      error: `Reason must be at most ${MAX_REASON_LENGTH} characters`,
    }
  }

  const decidedBy =
    typeof body.decided_by === "string" && body.decided_by.trim()
      ? body.decided_by.trim().slice(0, 200)
      : undefined

  return {
    ok: true,
    value: {
      finding_id: findingId,
      decision: decision as DecisionValue,
      reason,
      ...(decidedBy ? { decided_by: decidedBy } : {}),
    },
  }
}
