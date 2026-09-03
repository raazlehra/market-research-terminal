export function calculateChainRelativeIVPercentile(
  currentIV: number,
  currentChainIVs: number[]
): number {
  if (currentChainIVs.length === 0) return 50;

  const below = currentChainIVs.filter((iv) => iv < currentIV).length;
  return Math.round((below / currentChainIVs.length) * 100);
}

export const calculateIVPercentile = calculateChainRelativeIVPercentile;
