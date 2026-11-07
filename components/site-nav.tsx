import Link from "next/link"

export type NavPage = "review" | "canon" | "history"

const LINKS: { page: NavPage; href: string; label: string }[] = [
  { page: "review", href: "/", label: "Review" },
  { page: "canon", href: "/canon", label: "Brand Canon" },
  { page: "history", href: "/history", label: "History" },
]

export default function SiteNav({ active }: { active: NavPage }) {
  return (
    <header className="sticky top-3 z-30 mb-8">
      <nav
        aria-label="Primary"
        className="flex flex-wrap items-center justify-between gap-3 rounded-full border border-foreground/10 bg-card/85 px-4 py-2 shadow-lg shadow-black/20 backdrop-blur-md max-sm:rounded-2xl"
      >
        <Link
          href="/"
          aria-label="Verity home"
          className="flex items-center gap-2 rounded-full font-semibold text-foreground no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span
            aria-hidden="true"
            className="size-5 rounded-md bg-primary shadow-[0_0_16px_rgba(255,107,91,0.5)]"
          />
          <span>Verity</span>
        </Link>

        <ul className="flex flex-wrap items-center gap-1 p-0">
          {LINKS.map((link) => (
            <li key={link.page} className="list-none">
              <Link
                href={link.href}
                aria-current={active === link.page ? "page" : undefined}
                className={`inline-flex min-h-9 items-center rounded-full px-3 text-sm no-underline transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background ${
                  active === link.page
                    ? "bg-primary/15 text-foreground ring-1 ring-primary/40"
                    : "text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <span className="inline-flex min-h-8 items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 text-xs font-medium text-success">
          <span aria-hidden="true" className="size-2 rounded-full bg-success" />
          Review engine
        </span>
      </nav>
    </header>
  )
}
