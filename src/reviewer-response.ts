import type { ReviewVerdict } from "./reviewer.ts";
import type { SessionMessages } from "./todo-context.ts";

/** Returns the text of the newest assistant message that produced any text. */
export function reviewerResponseText(messages: SessionMessages): string {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.type !== "assistant" || !message.content) continue;
    const text = message.content
      .flatMap((part) => (part.type === "text" ? [(part as { text?: unknown }).text] : []))
      .filter((part): part is string => typeof part === "string")
      .join("\n");
    if (text.trim() !== "") return text;
  }
  throw new Error("Reviewer session did not produce a text response.");
}

export function parseVerdict(input: string): ReviewVerdict {
  const match = input.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("Reviewer response did not contain JSON.");
  }

  const parsed: unknown = JSON.parse(match[0]);
  if (!isRecord(parsed) || !isVerdict(parsed.verdict) || typeof parsed.reason !== "string") {
    throw new Error("Reviewer response did not match the verdict schema.");
  }
  return { verdict: parsed.verdict, reason: parsed.reason };
}

function isVerdict(input: unknown): input is ReviewVerdict["verdict"] {
  return input === "allow" || input === "deny" || input === "escalate";
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}
