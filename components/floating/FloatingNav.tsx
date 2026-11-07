import Link from "next/link"

export type NavActive = "review" | "canon" | "history"

const LINKS: { id: NavActive; href: string; label: string }[] = [
  { id: "review", href: "/", label: "Review" },
  { id: "canon", href: "/canon", label: "Brand Canon" },
  { id: "history", href: "/history", label: "History" },
]

export default function FloatingNav({ active }: { active: NavActive }) {
  return (
    <header className="vf-nav-wrap">
      <nav className="vf-nav" aria-label="Primary">
        <Link href="/" className="vf-brand" aria-label="Verity home">
          <span className="vf-brand-mark" aria-hidden="true" />
          <span>Verity</span>
        </Link>

        <ul className="vf-nav-list">
          {LINKS.map((link) => (
            <li key={link.id}>
              <Link
                href={link.href}
                className="vf-nav-link"
                aria-current={link.id === active ? "page" : undefined}
              >
                {link.label}
              </Link>
            </li>
          ))}
        </ul>

        <span className="vf-engine-pill">
          <span className="vf-dot" aria-hidden="true" />
          Review engine
        </span>
      </nav>
    </header>
  )
}
