// Round a value and clamp it into [min, max]. Returns null for non-numbers so
// callers can distinguish "missing" from a real 0.
export function clampInt(n, min, max) {
  const v = Math.round(Number(n));
  if (Number.isNaN(v)) return null;
  return Math.min(max, Math.max(min, v));
}
