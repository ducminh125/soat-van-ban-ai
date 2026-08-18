export const DEFAULT_ALLOWED_MODELS = [
  "gpt-5.4-nano",
  "gpt-5.6-terra",
];

export function sanitizeModel(
  requested: string | undefined,
  fallback = "gpt-5.4-nano"
): { requested: string; selected: string; changed: boolean; reason?: string } {
  const model = (requested || fallback).trim();

  // ShopAIKey production guard: avoid unstable ultra channels by default.
  if (model.includes("terra-ultra")) {
    return {
      requested: model,
      selected: "gpt-5.6-terra",
      changed: true,
      reason: "terra-ultra blocked by provider availability guard",
    };
  }

  if (!DEFAULT_ALLOWED_MODELS.includes(model)) {
    return {
      requested: model,
      selected: fallback,
      changed: true,
      reason: "model not in production allowlist",
    };
  }

  return { requested: model, selected: model, changed: false };
}
