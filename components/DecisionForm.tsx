"use client"

import { useState, type FormEvent } from "react"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"
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
      className="space-y-3 border-t border-foreground/10 pt-4"
      data-testid="decision-form"
    >
      <p className="m-0 text-[13px] font-medium text-foreground">Record a decision</p>
      <div className="flex flex-wrap gap-2">
        {ALLOWED_DECISIONS.map((value) => (
          <label
            key={value}
            className={`flex min-h-9 cursor-pointer items-center gap-2 rounded-md border px-3 py-2 text-[13px] capitalize transition-colors focus-within:ring-2 focus-within:ring-ring ${
              decision === value
                ? "border-primary/50 bg-primary/10 text-foreground"
                : "border-foreground/15 text-muted-foreground hover:bg-secondary hover:text-foreground"
            }`}
          >
            <input
              type="radio"
              name={`decision-${findingId}`}
              value={value}
              checked={decision === value}
              onChange={() => setDecision(value)}
              className="accent-primary"
            />
            {value}
          </label>
        ))}
      </div>
      <label className="block">
        <span className="sr-only">Reason for decision</span>
        <Textarea
          rows={2}
          maxLength={MAX_REASON_LENGTH}
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder="Required reason for this decision..."
          className="min-h-20 resize-y border-foreground/15 bg-background/60 text-sm leading-6 focus-visible:border-ring focus-visible:ring-ring/50"
        />
      </label>
      {reasonMissing && reason.length > 0 && (
        <p className="m-0 text-[13px] text-destructive">
          Reason must be at least {MIN_REASON_LENGTH} characters.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          size="lg"
          disabled={reasonMissing || status === "saving"}
          className="min-h-9 rounded-full bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90"
        >
          {status === "saving" ? "Saving..." : "Save decision"}
        </Button>
        {status === "saved" && (
          <span role="status" className="text-[13px] text-success">
            Decision saved.
          </span>
        )}
        {status === "error" && (
          <span role="alert" className="text-[13px] text-destructive">
            {message}
          </span>
        )}
      </div>
    </form>
  )
}
