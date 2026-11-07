const BASE = process.env.BASE_URL ?? "http://localhost:3000"
const FINDING_ID = process.env.FINDING_ID ?? "00000000-0000-4000-8000-000000000000"

async function post(body) {
  const response = await fetch(`${BASE}/api/decisions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })
  return response.status
}

const cases = [
  ["no body fields", {}, 400],
  ["missing finding id", { decision: "accepted", reason: "looks fine to me" }, 400],
  ["overridden, no reason", { finding_id: FINDING_ID, decision: "overridden" }, 400],
  ["overridden, blank reason", { finding_id: FINDING_ID, decision: "overridden", reason: "    " }, 400],
  ["overridden, too short", { finding_id: FINDING_ID, decision: "overridden", reason: "ok" }, 400],
  ["accepted, no reason", { finding_id: FINDING_ID, decision: "accepted" }, 400],
  ["dismissed, no reason", { finding_id: FINDING_ID, decision: "dismissed" }, 400],
  ["invalid decision", { finding_id: FINDING_ID, decision: "maybe", reason: "some reason" }, 400],
  [
    "unknown finding id",
    {
      finding_id: "00000000-0000-4000-8000-000000000000",
      decision: "accepted",
      reason: "valid reason",
    },
    404,
  ],
]

if (process.env.WRITE_TEST === "1" && process.env.FINDING_ID) {
  cases.push([
    "valid override with reason (WRITES a row)",
    {
      finding_id: FINDING_ID,
      decision: "overridden",
      reason: "Test: approved by legal on call",
    },
    201,
  ])
}

let failed = 0
for (const [name, body, expected] of cases) {
  const got = await post(body)
  const ok = got === expected
  if (!ok) failed++
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}  expected ${expected}, got ${got}`)
}
console.log(failed ? `\n${failed} failed` : "\nAll passed")
process.exit(failed ? 1 : 0)
