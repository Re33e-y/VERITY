import { GitBranch, ShieldCheck, UserCheck } from "lucide-react"
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"

const STEPS = [
  {
    icon: ShieldCheck,
    title: "Offline rules check first",
    description:
      "Brand rules, approved facts, quantities, expiry dates, and injection patterns are checked locally with no model call.",
  },
  {
    icon: GitBranch,
    title: "Only doubtful claims reach the router",
    description:
      "Ambiguous claims go to a single Gemini judge call, and repeat reviews are served from cache when possible.",
  },
  {
    icon: UserCheck,
    title: "You make the final call",
    description:
      "Accept, dismiss, or override each finding with a written reason that is saved to the history.",
  },
]

export default function HowItWorks() {
  return (
    <div className="grid gap-4" aria-label="How Verity works">
      {STEPS.map((step) => {
        const Icon = step.icon
        return (
          <Card key={step.title} className="border-foreground/10 bg-card/80 shadow-sm">
            <CardHeader className="grid grid-cols-[auto_1fr] items-center gap-3">
              <span className="grid size-10 place-items-center rounded-full border border-primary/40 bg-primary/10 text-primary">
                <Icon size={18} aria-hidden="true" />
              </span>
              <CardTitle className="text-base font-semibold">{step.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-6 text-muted-foreground">
              {step.description}
            </CardContent>
          </Card>
        )
      })}
    </div>
  )
}
