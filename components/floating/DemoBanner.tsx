"use client"

import { useState } from "react"

export default function DemoBanner() {
  const [open, setOpen] = useState(true)
  if (!open) return null

  return (
    <div className="vf-banner" role="note">
      <p>
        Demo: use synthetic content only. There is no login, and review history
        is publicly visible.
      </p>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Dismiss demo notice"
      >
        Dismiss
      </button>
    </div>
  )
}
