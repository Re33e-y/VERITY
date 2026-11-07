import Link from "next/link"

export default function SiteFooter() {
  return (
    <footer className="vf-footer">
      <p>
        Offline rules run first. AI is used only when rules cannot resolve an
        ambiguous case. Use synthetic content only; this demo has no
        authentication.
      </p>
      <ul className="vf-footer-links">
        <li>
          <Link href="/history">History</Link>
        </li>
        <li>
          <Link href="/canon">Brand Canon</Link>
        </li>
      </ul>
    </footer>
  )
}
