"use client"

import * as AccordionPrimitive from "@radix-ui/react-accordion"
import {
  Ban,
  ChevronDown,
  Clock,
  HelpCircle,
  Megaphone,
  Scale,
  ShieldAlert,
  type LucideIcon,
} from "lucide-react"
import type { ReactNode } from "react"
import { Badge } from "@/components/ui/badge"

const KIND_STYLE: Record<
  string,
  { icon: LucideIcon; iconClass: string; badgeClass: string }
> = {
  Contradicted: {
    icon: Ban,
    iconClass: "border-destructive/45 bg-destructive/10 text-destructive",
    badgeClass: "border-destructive/40 bg-destructive/10 text-destructive",
  },
  Outdated: {
    icon: Clock,
    iconClass: "border-warning/45 bg-warning/10 text-warning",
    badgeClass: "border-warning/40 bg-warning/10 text-warning",
  },
  Unsupported: {
    icon: HelpCircle,
    iconClass: "border-info/45 bg-info/10 text-info",
    badgeClass: "border-info/40 bg-info/10 text-info",
  },
  "Needs legal review": {
    icon: Scale,
    iconClass: "border-violet/45 bg-violet/10 text-violet",
    badgeClass: "border-violet/40 bg-violet/10 text-violet",
  },
  "Instruction-like": {
    icon: ShieldAlert,
    iconClass: "border-primary/45 bg-primary/10 text-primary",
    badgeClass: "border-primary/40 bg-primary/10 text-primary",
  },
  Supported: {
    icon: Megaphone,
    iconClass: "border-success/45 bg-success/10 text-success",
    badgeClass: "border-success/40 bg-success/10 text-success",
  },
  Tone: {
    icon: Megaphone,
    iconClass: "border-violet/45 bg-violet/10 text-violet",
    badgeClass: "border-violet/40 bg-violet/10 text-violet",
  },
  Rule: {
    icon: Megaphone,
    iconClass: "border-foreground/20 bg-secondary text-foreground",
    badgeClass: "border-foreground/20 bg-secondary text-foreground",
  },
}

const FALLBACK = KIND_STYLE.Rule

export type FindingItem = {
  id: string
  kind: string
  title: string
  verdict: string
  grade: string
  source: "rule" | "ai"
  body: ReactNode
}

type Props = {
  items: FindingItem[]
  value: string | null
  onOpen?: (id: string | null) => void
}

export default function FindingsAccordion({ items, value, onOpen }: Props) {
  if (items.length === 0) return null

  return (
    <AccordionPrimitive.Root
      type="single"
      collapsible
      value={value ?? ""}
      onValueChange={(nextValue) => onOpen?.(nextValue || null)}
      className="w-full"
    >
      {items.map((item) => {
        const style = KIND_STYLE[item.kind] ?? FALLBACK
        const Icon = style.icon

        return (
          <AccordionPrimitive.Item
            key={item.id}
            value={item.id}
            className="border-b border-foreground/10 last:border-b-0"
            data-kind={item.kind}
          >
            <AccordionPrimitive.Header>
              <AccordionPrimitive.Trigger className="group flex w-full min-w-0 items-center justify-between gap-3 rounded-lg px-2 py-3 text-left outline-none transition-colors hover:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card">
                <span className="flex min-w-0 flex-1 items-center gap-3">
                  <span
                    className={`grid size-10 shrink-0 place-items-center rounded-full border ${style.iconClass}`}
                    aria-hidden="true"
                  >
                    <Icon size={16} strokeWidth={2} />
                  </span>
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="break-words text-sm font-semibold leading-5 text-foreground [overflow-wrap:anywhere]">
                      {item.title}
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-[13px] text-muted-foreground">
                      <Badge
                        variant="outline"
                        className={`h-6 max-w-full whitespace-normal px-2 py-0.5 text-[13px] leading-4 ${style.badgeClass}`}
                      >
                        {item.verdict}
                      </Badge>
                      <Badge
                        variant="outline"
                        className="h-6 border-foreground/20 px-2 py-0.5 text-[13px] leading-4 text-foreground"
                      >
                        Grade {item.grade}
                      </Badge>
                      <span>{item.source === "rule" ? "Offline rule" : "AI"}</span>
                    </span>
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  strokeWidth={2}
                  className="size-4 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
                  aria-hidden="true"
                />
              </AccordionPrimitive.Trigger>
            </AccordionPrimitive.Header>
            <AccordionPrimitive.Content className="overflow-hidden">
              <div className="space-y-4 px-2 pb-4 pt-2 sm:pl-[60px]">
                {item.body}
              </div>
            </AccordionPrimitive.Content>
          </AccordionPrimitive.Item>
        )
      })}
    </AccordionPrimitive.Root>
  )
}
