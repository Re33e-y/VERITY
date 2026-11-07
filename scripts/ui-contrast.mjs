// WCAG 2.x contrast check for the Verity floating palette.
// Large text (18px bold or 24px) needs 3:1; everything else needs 4.5:1.

const T = {
  text: "#f4ede0",
  text2: "#cfc8bb",
  muted: "#a9b0c0",
  accent: "#ff6b5b",
  onAccent: "#14213d",
  success: "#34d399",
  warning: "#fbbf24",
  danger: "#f87171",
  info: "#7dd3fc",
  violet: "#a78bfa",
  bg: "#0e182e",
  surface: "#14213d",
  inset: "#1b2a4a",
  successText: "#6ee7b7",
  warningText: "#fde68a",
  dangerText: "#fecaca",
};

// [label, foreground, background, minimum ratio]
const PAIRS = [
  ["text on page", T.text, T.bg, 4.5],
  ["text on surface", T.text, T.surface, 4.5],
  ["text on inset", T.text, T.inset, 4.5],
  ["secondary on surface", T.text2, T.surface, 4.5],
  ["secondary on inset", T.text2, T.inset, 4.5],
  ["muted on surface", T.muted, T.surface, 4.5],
  ["muted on inset", T.muted, T.inset, 4.5],
  ["muted on page", T.muted, T.bg, 4.5],
  ["accent link on surface", T.accent, T.surface, 4.5],
  ["accent link on page", T.accent, T.bg, 4.5],
  ["button text on accent", T.onAccent, T.accent, 4.5],
  ["success on surface", T.success, T.surface, 4.5],
  ["warning on surface", T.warning, T.surface, 4.5],
  ["danger on surface", T.danger, T.surface, 4.5],
  ["info icon on surface", T.info, T.surface, 3],
  ["violet icon on surface", T.violet, T.surface, 3],
  ["success heading on tinted notice", T.successText, "#143a3a", 4.5],
  ["warning heading on tinted notice", T.warningText, "#3a3534", 4.5],
  ["danger heading on tinted notice", T.dangerText, "#3d2a3a", 4.5],
  ["banner text on tinted amber", "#fde68a", "#2b2a2c", 4.5],
];

function channel(v) {
  const c = v / 255;
  return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function ratio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

let failed = 0;
console.log("pair".padEnd(38), "ratio".padStart(7), "needs".padStart(6), " result");

for (const [label, fg, bg, min] of PAIRS) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failed += 1;
  console.log(
    label.padEnd(38),
    r.toFixed(2).padStart(7),
    String(min).padStart(6),
    ok ? " pass" : " FAIL",
  );
}

console.log(failed ? `\n${failed} pair(s) below the minimum.` : "\nAll pairs pass.");
process.exit(failed ? 1 : 0);
