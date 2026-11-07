import Link from "next/link"

export type NavPage = "review" | "canon" | "history"

const LINKS: { page: NavPage; href: string; label: string }[] = [
  { page: "review", href: "/", label: "Review" },
  { page: "canon", href: "/canon", label: "Brand Canon" },
  { page: "history", href: "/history", label: "History" },
]

export default function SiteNav({ active }: { active: NavPage }) {
  return (
    <header className="mb-8 sm:sticky sm:top-3 sm:z-30">
      <nav
        aria-label="Primary"
        className="flex flex-wrap items-center justify-between gap-3 rounded-full border border-foreground/10 bg-card/85 px-4 py-2 shadow-lg shadow-black/20 backdrop-blur-md max-sm:rounded-2xl"
      >
        <Link
          href="/"
          aria-label="Verity home"
          className="order-1 flex items-center gap-2 rounded-full font-semibold text-foreground no-underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <span
            aria-hidden="true"
            className="size-5 rounded-md bg-primary shadow-[0_0_16px_rgba(255,107,91,0.5)]"
          />
          <span>Verity</span>
        </Link>

        <ul className="order-3 flex w-full min-w-0 flex-wrap items-center justify-between gap-1 p-0 sm:order-2 sm:w-auto sm:justify-start">
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

        <span className="order-2 inline-flex min-h-8 items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 text-[13px] font-medium text-success sm:order-3">
          <span aria-hidden="true" className="size-2 rounded-full bg-success" />
          Review engine
        </span>
      </nav>
    </header>
  )
}
