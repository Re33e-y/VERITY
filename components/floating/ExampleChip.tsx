"use client"

type Props = {
  label: string
  pressed?: boolean
  onPick: () => void
}

export default function ExampleChip({ label, pressed, onPick }: Props) {
  return (
    <button
      type="button"
      className="vf-chip"
      onClick={onPick}
      aria-pressed={pressed ?? false}
    >
      {label}
    </button>
  )
}
