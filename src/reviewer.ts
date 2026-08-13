import type { ModelReference, PluginConfiguration } from "./config.js";

type ReviewSource = "permission-request" | "tool-call";

export type ReviewRequest = {
  source: ReviewSource;
  sessionID: string;
  action: string;
  resource: unknown;
  userIntent?: string;
  model?: ModelReference;
};

export type ReviewVerdict = {
  verdict: "allow" | "deny" | "escalate";
  reason: string;
};

export type ReviewSessionClient = {
  session: {
    create(input: { query: { directory: string } }): Promise<unknown>;
    prompt(input: {
      path: { id: string };
      query: { directory: string };
      body: {
        agent: string;
        model?: ModelReference;
        parts: Array<{ type: "text"; text: string }>;
        tools: Record<string, boolean>;
      };
    }): Promise<unknown>;
    abort?(input: { path: { id: string }; query: { directory: string } }): Promise<unknown>;
  };
};

export const reviewerAgentName = "auto-approval-reviewer";

const reviewerTools = {
  read: true,
  glob: true,
  grep: true,
  lsp: true,
};

export class Reviewer {
  readonly #client: ReviewSessionClient;
  readonly #configuration: PluginConfiguration;
  readonly #directory: string;
  readonly #reviewerSessionIDs = new Set<string>();

  constructor(input: {
    client: ReviewSessionClient;
    configuration: PluginConfiguration;
    directory: string;
  }) {
    this.#client = input.client;
    this.#configuration = input.configuration;
    this.#directory = input.directory;
  }

  isReviewerSession(input: { sessionID: string }): boolean {
    return this.#reviewerSessionIDs.has(input.sessionID);
  }

  async review(input: ReviewRequest): Promise<ReviewVerdict> {
    const session = await this.#client.session.create({ query: { directory: this.#directory } });
    const sessionID = sessionIdentifier(session);
    this.#reviewerSessionIDs.add(sessionID);

    try {
      const response = await withTimeout({
        operation: this.#client.session.prompt({
          path: { id: sessionID },
          query: { directory: this.#directory },
          body: {
            agent: reviewerAgentName,
            ...((this.#configuration.reviewer.model ?? input.model)
              ? { model: this.#configuration.reviewer.model ?? input.model }
              : {}),
            parts: [{ type: "text", text: reviewerPrompt(input) }],
            tools: reviewerTools,
          },
        }),
        timeoutMs: this.#configuration.reviewer.timeoutMs,
      });
      return parseVerdict(responseText(response));
    } catch (error) {
      void this.#client.session.abort?.({
        path: { id: sessionID },
        query: { directory: this.#directory },
      });
      throw error;
    } finally {
      this.#reviewerSessionIDs.delete(sessionID);
    }
  }
}

export function reviewerAgent(): Record<string, unknown> {
  return {
    description: "Read-only reviewer for auto-approval decisions.",
    mode: "subagent",
    prompt:
      "You are a security reviewer. You may inspect the workspace only through read, glob, grep, and lsp. Never modify files, run shell commands, access the network, use MCP tools, or delegate work.",
    tools: reviewerTools,
    permission: {
      "*": "deny",
      read: "allow",
      glob: "allow",
      grep: "allow",
      lsp: "allow",
      edit: "deny",
      bash: "deny",
      task: "deny",
      skill: "deny",
      webfetch: "deny",
      websearch: "deny",
      question: "deny",
      external_directory: "deny",
    },
  };
}

function sessionIdentifier(input: unknown): string {
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

function reviewerPrompt(input: ReviewRequest): string {
  return [
    "Review this requested OpenCode operation. Decide whether it is safe and within the user's intent.",
    "Return JSON only, with this exact schema:",
    '{"verdict":"allow"|"deny"|"escalate","reason":"short explanation"}',
    "Use escalate when human confirmation is needed. Use deny for unsafe or clearly unauthorized operations.",
    `Source: ${input.source}`,
    `Action: ${input.action}`,
    `Resource: ${JSON.stringify(input.resource)}`,
    `User intent: ${input.userIntent ?? "No user intent was captured; escalate unless the operation is clearly harmless."}`,
  ].join("\n");
}

function responseText(input: unknown): string {
  const response = unwrapData(input);
  if (!isRecord(response) || !Array.isArray(response.parts)) {
    throw new Error("OpenCode SDK did not return reviewer message parts.");
  }

  return response.parts
    .flatMap((part) => (isRecord(part) && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
}

function parseVerdict(input: string): ReviewVerdict {
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

async function withTimeout<T>(input: { operation: Promise<T>; timeoutMs: number }): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      input.operation,
      new Promise<T>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error("Reviewer timed out.")), input.timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}
