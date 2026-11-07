"use client"

type Props = {
  loading: boolean
  disabled?: boolean
  onClick: () => void
}

export default function AuditButton({ loading, disabled, onClick }: Props) {
  const isDisabled = Boolean(disabled) || loading

  return (
    <button
      type="button"
      className="vf-btn vf-btn-primary"
      onClick={onClick}
      disabled={isDisabled}
      aria-busy={loading}
    >
      {loading ? (
        <>
          <span className="vf-spinner" aria-hidden="true" />
          Auditing...
        </>
      ) : (
        "Run governance audit"
      )}
    </button>
  )
}
