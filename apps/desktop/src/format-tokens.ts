export function formatTokens(tokens: number): string {
  const tenthsOfK = Math.round(tokens / 100);
  if (tenthsOfK >= 10_000) return `${(Math.round(tokens / 100_000) / 10).toFixed(1)}M`;
  if (tokens >= 1_000) return `${(tenthsOfK / 10).toFixed(1)}K`;
  return String(tokens);
}
