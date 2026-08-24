import type { ReviewVerdict } from "./reviewer.js";

export type ToastVariant = "info" | "success" | "warning" | "error";

export function decisionNotification(input: { action: string; decision: ReviewVerdict }): {
  message: string;
  variant: ToastVariant;
} {
  const outcome =
    input.decision.verdict === "allow"
      ? "allowed"
      : input.decision.verdict === "deny"
        ? "denied"
        : "escalated";
  return {
    message: `[Auto-approval] reviewer ${outcome} \`${input.action}\`\n\n${input.decision.reason}`,
    variant: input.decision.verdict === "allow" ? "success" : "warning",
  };
}

export function failClosedNotification(input: { action: string; error: unknown }): {
  message: string;
  variant: ToastVariant;
} {
  return {
    message: `[Auto-approval] reviewer failed for \`${input.action}\`\n\n${errorMessage(input.error)}`,
    variant: "error",
  };
}

export function errorMessage(input: unknown): string {
  return input instanceof Error ? input.message : String(input);
}
