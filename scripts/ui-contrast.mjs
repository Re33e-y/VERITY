const colors = {
  cream: "#F4EDE0",
  secondary: "#CFC8BB",
  muted: "#A9B0C0",
  coral: "#FF6B5B",
  navy: "#14213D",
  success: "#34D399",
  warning: "#FBBF24",
  destructive: "#F87171",
}

const backgrounds = {
  "page navy": "#0E182E",
  "card navy": "#14213D",
  "muted navy": "#1B2A4A",
}

function linearChannel(value) {
  const channel = value / 255
  return channel <= 0.04045
    ? channel / 12.92
    : ((channel + 0.055) / 1.055) ** 2.4
}

function luminance(hex) {
  const value = Number.parseInt(hex.slice(1), 16)
  return (
    0.2126 * linearChannel((value >> 16) & 255) +
    0.7152 * linearChannel((value >> 8) & 255) +
    0.0722 * linearChannel(value & 255)
  )
}

function contrast(foreground, background) {
  const first = luminance(foreground)
  const second = luminance(background)
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05)
}

const checks = []
for (const [name, foreground] of Object.entries(colors)) {
  if (name === "navy") continue
  for (const [backgroundName, background] of Object.entries(backgrounds)) {
    checks.push({
      label: `${name} on ${backgroundName}`,
      foreground,
      background,
      minimum: 4.5,
      usage: "small text",
    })
  }
}

checks.push({
  label: "navy on coral",
  foreground: colors.navy,
  background: colors.coral,
  minimum: 4.5,
  usage: "small text",
})

console.log("pair".padEnd(28), "ratio".padStart(7), "minimum".padStart(9), "result")
let failed = 0

for (const check of checks) {
  const ratio = contrast(check.foreground, check.background)
  const passed = ratio >= check.minimum
  if (!passed) failed += 1
  console.log(
    check.label.padEnd(28),
    `${ratio.toFixed(2)}:1`.padStart(7),
    `${check.minimum.toFixed(1)}:1`.padStart(9),
    passed ? "PASS" : "FAIL",
  )
}

console.log(
  `\nLarge text and icons use a 3:1 minimum; all listed pairs were checked against the stricter 4.5:1 small-text minimum.`,
)
console.log(failed ? `${failed} contrast check(s) failed.` : "All contrast checks pass.")
process.exit(failed ? 1 : 0)
