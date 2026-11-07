import type { CSSProperties } from "react"

export type Tone = "success" | "warning" | "danger"

export function toneForScore(score: number): Tone {
  if (score >= 90) return "success"
  if (score >= 70) return "warning"
  return "danger"
}

type Props = {
  score: number | null
  label: string
  tone?: Tone
  size?: number
}

export default function ScoreRing({ score, label, tone, size = 132 }: Props) {
  const hasScore = typeof score === "number" && Number.isFinite(score)
  const percentage = hasScore ? Math.max(0, Math.min(100, Math.round(score))) : 0
  const resolvedTone = tone ?? (hasScore ? toneForScore(percentage) : "warning")
  const style = {
    "--vf-pct": percentage,
    "--vf-size": `${size}px`,
  } as CSSProperties

  return (
    <div
      className={`vf-ring vf-tone-${resolvedTone}`}
      style={style}
      role="img"
      aria-label={
        hasScore
          ? `Score ${percentage} out of 100, ${label}`
          : `Score withheld, ${label}`
      }
    >
      <div className="vf-ring-dial">
        <div className="vf-ring-inner">
          <span className="vf-ring-score">{hasScore ? percentage : "n/a"}</span>
          <span className="vf-ring-of">{hasScore ? "out of 100" : "withheld"}</span>
        </div>
      </div>
      <span className="vf-ring-label">{label}</span>
    </div>
  )
}
