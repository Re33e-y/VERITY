"use client"

import { useState, type FormEvent } from "react"
import {
  ALLOWED_DECISIONS,
  MIN_REASON_LENGTH,
  MAX_REASON_LENGTH,
  type DecisionValue,
} from "@/lib/review/decisionValidation"

type Props = {
  findingId: string
  onSaved?: () => void
}

export default function DecisionForm({ findingId, onSaved }: Props) {
  const [decision, setDecision] = useState<DecisionValue>("accepted")
  const [reason, setReason] = useState("")
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">("idle")
  const [message, setMessage] = useState("")
  const reasonMissing = reason.trim().length < MIN_REASON_LENGTH

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (reasonMissing || status === "saving") return

    setStatus("saving")
    setMessage("")
    try {
      const response = await fetch("/api/decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          finding_id: findingId,
          decision,
          reason,
        }),
      })
      const data: unknown = await response.json().catch(() => null)
      if (!response.ok) {
        const error =
          typeof data === "object" &&
          data !== null &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : `Decision could not be saved (${response.status}).`
        setStatus("error")
        setMessage(error)
        return
      }

      setStatus("saved")
      setReason("")
      onSaved?.()
    } catch {
      setStatus("error")
      setMessage("Network error. Try again.")
    }
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-3 border-t border-slate-800 pt-4"
      data-testid="decision-form"
    >
      <p className="text-xs font-medium text-slate-300">Record a decision</p>
      <div className="flex flex-wrap gap-2">
        {ALLOWED_DECISIONS.map((value) => (
          <label
            key={value}
            className={`flex cursor-pointer items-center gap-1.5 rounded-md border px-3 py-2 text-xs capitalize focus-within:ring-2 focus-within:ring-indigo-500 ${
              decision === value
                ? "border-indigo-400 bg-indigo-500/20 text-indigo-200"
                : "border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <input
              type="radio"
              name={`decision-${findingId}`}
              value={value}
              checked={decision === value}
              onChange={() => setDecision(value)}
              className="accent-indigo-400"
            />
            {value}
          </label>
        ))}
      </div>
      <label className="block">
        <span className="sr-only">Reason for decision</span>
        <textarea
          rows={2}
          maxLength={MAX_REASON_LENGTH}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Required reason for this decision..."
          className="w-full rounded-md border border-slate-700 bg-slate-900 p-3 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </label>
      {reasonMissing && reason.length > 0 && (
        <p className="text-xs text-red-300">
          Reason must be at least {MIN_REASON_LENGTH} characters.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="submit"
          disabled={reasonMissing || status === "saving"}
          className="rounded-md bg-slate-700 px-3 py-2 text-xs text-white hover:bg-slate-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {status === "saving" ? "Saving..." : "Save decision"}
        </button>
        {status === "saved" && (
          <span role="status" className="text-xs text-emerald-300">
            Decision saved.
          </span>
        )}
        {status === "error" && (
          <span role="alert" className="text-xs text-red-300">
            {message}
          </span>
        )}
      </div>
    </form>
  )
}
