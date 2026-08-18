export function isProviderUnavailable(error: unknown): boolean {
  const text = String(error || "").toLowerCase();
  return (
    text.includes("503") ||
    text.includes("no available channel") ||
    text.includes("无可用渠道") ||
    text.includes("unavailable channel")
  );
}

export function shouldFallback(error: unknown): boolean {
  return isProviderUnavailable(error);
}
