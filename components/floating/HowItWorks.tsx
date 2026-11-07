import { GitBranch, ShieldCheck, UserCheck } from "lucide-react"

const STEPS = [
  {
    icon: ShieldCheck,
    title: "Offline rules check first",
    text: "Brand rules, approved facts, quantities, expiry dates and injection patterns are checked locally. No model is called.",
  },
  {
    icon: GitBranch,
    title: "Ambiguous claims get an AI review",
    text: "Claims that offline rules cannot resolve are routed for AI judgment and verification. Cached repeats may avoid new calls.",
  },
  {
    icon: UserCheck,
    title: "You make the decision",
    text: "Accept, dismiss or override each finding. Every decision needs a written reason and is saved to the history.",
  },
]

export default function HowItWorks() {
  return (
    <ol className="vf-how" aria-label="How Verity works">
      {STEPS.map((step) => {
        const Icon = step.icon
        return (
          <li key={step.title} className="vf-how-step">
            <span className="vf-how-icon" aria-hidden="true">
              <Icon size={18} strokeWidth={2} />
            </span>
            <h3>{step.title}</h3>
            <p>{step.text}</p>
          </li>
        )
      })}
    </ol>
  )
}
