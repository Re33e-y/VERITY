export type Stat = {
  label: string
  value: string | number
  tone?: "neutral" | "success" | "warning" | "danger"
}

export default function StatTiles({ stats }: { stats: Stat[] }) {
  return (
    <dl className="vf-stats" aria-label="Audit statistics">
      {stats.map((stat) => (
        <div
          key={stat.label}
          className={`vf-stat vf-stat-${stat.tone ?? "neutral"}`}
        >
          <dt className="vf-stat-label">{stat.label}</dt>
          <dd className="vf-stat-value" style={{ margin: 0 }}>
            {stat.value}
          </dd>
        </div>
      ))}
    </dl>
  )
}
