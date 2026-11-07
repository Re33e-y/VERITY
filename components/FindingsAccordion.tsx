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

const KIND_ICON: Record<string, LucideIcon> = {
  Contradicted: Ban,
  Outdated: Clock,
  Unsupported: HelpCircle,
  "Needs legal review": Scale,
  "Instruction-like": ShieldAlert,
  Tone: Megaphone,
  Rule: Megaphone,
}

const FALLBACK = KIND_ICON.Rule

export type FindingItem = {
  id: string
  kind: string
  title: string
  sub?: string
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
      className="vf-acc"
    >
      {items.map((item) => {
        const Icon = KIND_ICON[item.kind] ?? FALLBACK

        return (
          <AccordionPrimitive.Item
            key={item.id}
            value={item.id}
            className="vf-acc-item"
            data-kind={item.kind}
          >
            <AccordionPrimitive.Header className="vf-acc-header">
              <AccordionPrimitive.Trigger className="vf-acc-trigger">
                <span className="vf-acc-lead">
                  <span
                    className="vf-acc-icon"
                    aria-hidden="true"
                  >
                    <Icon size={16} strokeWidth={2} />
                  </span>
                  <span className="vf-acc-text">
                    <span className="vf-acc-title">{item.title}</span>
                    {item.sub && (
                      <span className="vf-acc-sub">{item.sub}</span>
                    )}
                  </span>
                </span>
                <ChevronDown
                  size={16}
                  strokeWidth={2}
                  className="vf-acc-chevron"
                  aria-hidden="true"
                />
              </AccordionPrimitive.Trigger>
            </AccordionPrimitive.Header>
            <AccordionPrimitive.Content className="vf-acc-content">
              <div className="vf-acc-body">
                {item.body}
              </div>
            </AccordionPrimitive.Content>
          </AccordionPrimitive.Item>
        )
      })}
    </AccordionPrimitive.Root>
  )
}
