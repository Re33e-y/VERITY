"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"

export default function DemoBanner() {
  const [visible, setVisible] = useState(true)
  if (!visible) return null

  return (
    <aside
      role="note"
      className="mb-3 flex items-start justify-between gap-3 rounded-xl border border-warning/35 bg-warning/10 px-4 py-3 text-sm text-warning"
    >
      <p className="m-0">
        Demo: use synthetic content only. There is no login, and review history
        is publicly visible.
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="min-h-9 shrink-0 rounded-full border-warning/40 bg-transparent text-warning hover:bg-warning/15 hover:text-warning"
        onClick={() => setVisible(false)}
        aria-label="Dismiss demo notice"
      >
        Dismiss
      </Button>
    </aside>
  )
}
