import type { ReviewVerdict } from "./reviewer.js";

export function sessionIdentifier(input: unknown): string {
  if (
    typeof input === "object" &&
    input !== null &&
    "id" in input &&
    typeof input.id === "string"
  ) {
    return input.id;
  }
  if (
    typeof input === "object" &&
    input !== null &&
    "data" in input &&
    typeof input.data === "object" &&
    input.data !== null &&
    "id" in input.data &&
    typeof input.data.id === "string"
  ) {
    return input.data.id;
  }
  throw new Error("OpenCode SDK did not return a reviewer session ID.");
}

export function responseText(input: unknown): string {
  const response = unwrapData(input);
  if (!isRecord(response) || !Array.isArray(response.parts)) {
    throw new Error("OpenCode SDK did not return reviewer message parts.");
  }

  return response.parts
    .flatMap((part) => (isRecord(part) && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
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

function unwrapData(input: unknown): unknown {
  if (isRecord(input) && "data" in input) return input.data;
  return input;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}
