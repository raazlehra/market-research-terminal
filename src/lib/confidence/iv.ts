export function calculateIVPercentile(
  currentIV: number,
  ivHistory: number[]
): number {
  if (ivHistory.length === 0) return 50;

  const below = ivHistory.filter((iv) => iv < currentIV).length;
  return Math.round((below / ivHistory.length) * 100);
}
