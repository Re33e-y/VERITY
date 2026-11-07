type Props = {
  route?: string | null
  llmCalls?: number | null
  cached?: boolean
}

export default function RouteNote({ route, llmCalls, cached }: Props) {
  if (typeof llmCalls !== "number") return null

  let text: string
  if (llmCalls === 0 && cached) text = "Served from cache, 0 LLM calls"
  else if (llmCalls === 0) text = "Resolved locally, 0 LLM calls"
  else text = `Used ${llmCalls} LLM call${llmCalls === 1 ? "" : "s"}`

  return (
    <p
      className="inline-flex items-center gap-2 rounded bg-slate-800 px-2 py-1 text-sm text-slate-300"
      data-testid="route-note"
    >
      <span>{text}</span>
      {route ? <span className="text-xs text-slate-400">route: {route}</span> : null}
    </p>
  )
}
