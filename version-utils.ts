export function compareNumericVersions(left: string, right: string): number | null {
  const normalize = (input: string): number[] | null => {
    const clean = String(input || "").trim().replace(/^v/i, "").split(/[+-]/, 1)[0];
    if (!/^\d+(?:\.\d+)*$/.test(clean)) return null;
    return clean.split(".").map((part) => Number(part));
  };
  const a = normalize(left);
  const b = normalize(right);
  if (!a || !b) return null;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index++) {
    const difference = (a[index] || 0) - (b[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

export function isNewerVersion(candidate: string, current: string): boolean {
  return compareNumericVersions(candidate, current) === 1;
}