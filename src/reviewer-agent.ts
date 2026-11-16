import type { ModelReference } from "./config.ts";

/** Title and metadata marker used to find reviewer sessions for cleanup. */
export const reviewerSessionTitle = "opencode-auto-approve-reviewer";
export const reviewerMetadataKey = "autoApprovalReviewer";

/** Tools the reviewer may use. Everything else is denied. */
const reviewerToolNames = ["read", "glob", "grep"] as const;

const reviewerToolSet = new Set<string>(reviewerToolNames);

export function isReviewerToolAllowed(tool: string): boolean {
  return reviewerToolSet.has(tool);
}

/**
 * Ordered session rules: the catch-all deny comes first so later allow rules win.
 */
export const reviewerPermissions = [
  { action: "*", resource: "*", effect: "deny" as const },
  ...reviewerToolNames.map((action) => ({ action, resource: "*", effect: "allow" as const })),
];

const reviewerPersona = [
  "You are a read-only security reviewer for another agent's permission requests.",
  "You may inspect the workspace only through read, glob, and grep.",
  "Never modify files, run shell commands, access the network, use MCP tools, or delegate work.",
].join("\n");

/**
 * Applies the reviewer persona and restricts the session's tool set. Called from the
 * session context hook, where both fields are mutable per request.
 */
export function applyReviewerContext(input: {
  system: Array<{ type: "text"; text: string }>;
  tools: Record<string, unknown>;
}): void {
  input.system.push({ type: "text", text: reviewerPersona });
  for (const tool of Object.keys(input.tools)) {
    if (!isReviewerToolAllowed(tool)) delete input.tools[tool];
  }
}

type ReasoningAdapter = (options: Record<string, unknown>) => void;

/**
 * Reasoning is disabled with the option shape each provider family understands. Providers without
 * a dedicated adapter receive `reasoningEffort: "none"`, which unknown keys treat as a no-op.
 */
const reasoningAdapters: Readonly<Record<string, ReasoningAdapter>> = {
  anthropic: (options) => {
    options.thinking = { type: "disabled" };
  },
  alibaba: (options) => {
    options.thinking = { type: "disabled" };
  },
  google: (options) => {
    options.thinkingConfig = { includeThoughts: false, thinkingBudget: 0 };
  },
  "google-vertex": (options) => {
    options.thinkingConfig = { includeThoughts: false, thinkingBudget: 0 };
  },
};

export function disableReasoning(input: {
  providerID: string;
  options: Record<string, unknown>;
}): void {
  const adapter = reasoningAdapters[input.providerID];
  if (adapter) {
    adapter(input.options);
    return;
  }
  input.options.reasoningEffort = "none";
}

/** Adapts the plugin's configuration shape to the session model reference shape. */
export function sessionModel(reference: ModelReference): {
  providerID: string;
  id: string;
  variant?: string;
} {
  return {
    providerID: reference.providerID,
    id: reference.modelID,
    ...(reference.variant === undefined ? {} : { variant: reference.variant }),
  };
}
