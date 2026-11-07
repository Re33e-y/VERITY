import Link from "next/link"

export default function SiteFooter() {
  return (
    <footer className="relative z-[1] mx-auto mt-auto w-full max-w-[1200px] px-4 pb-8 pt-6 sm:px-6">
      <div className="flex flex-col gap-3 border-t border-foreground/10 pt-5 text-[13px] leading-5 text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <p className="m-0 max-w-3xl">
          Offline rules run first. A Gemini judge handles ambiguous cases only.
          Use synthetic content only. This demo has no authentication.
        </p>
        <nav aria-label="Footer" className="flex shrink-0 gap-4">
          <Link
            href="/history"
            className="rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            History
          </Link>
          <Link
            href="/canon"
            className="rounded-sm underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            Brand Canon
          </Link>
        </nav>
      </div>
    </footer>
  )
}
