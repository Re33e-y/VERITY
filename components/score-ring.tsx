import type { CSSProperties } from "react"

export type RingTone = "success" | "warning" | "danger"

export function toneForScore(score: number): RingTone {
  if (score >= 90) return "success"
  if (score >= 70) return "warning"
  return "danger"
}

const COLOR: Record<RingTone, string> = {
  success: "var(--success)",
  warning: "var(--warning)",
  danger: "var(--destructive)",
}

type Props = { score: number | null; tone?: RingTone; size?: number }

export default function ScoreRing({ score, tone, size = 128 }: Props) {
  const numericScore =
    typeof score === "number" && Number.isFinite(score) ? score : null
  const pct =
    numericScore === null
      ? 0
      : Math.max(0, Math.min(100, Math.round(numericScore)))
  const color = COLOR[tone ?? (numericScore === null ? "warning" : toneForScore(pct))]
  const inner = size - 22
  const dial: CSSProperties = {
    width: size,
    height: size,
    background: `conic-gradient(${color} ${pct}%, rgba(244,237,224,0.12) 0)`,
    boxShadow: `0 0 40px -8px ${color}`,
  }

  return (
    <div
      role="img"
      aria-label={numericScore === null ? "Score withheld" : `Score ${pct} out of 100`}
      className="grid shrink-0 place-items-center rounded-full"
      style={dial}
    >
      <div
        className="grid place-items-center rounded-full bg-card text-center leading-none"
        style={{ width: inner, height: inner }}
      >
        <span className="text-4xl font-extrabold tracking-tight">
          {numericScore === null ? "n/a" : pct}
        </span>
        <span className="-mt-3 text-[13px] text-muted-foreground">
          {numericScore === null ? "withheld" : "out of 100"}
        </span>
      </div>
    </div>
  )
}
