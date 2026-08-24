import type { ModelReference, PluginConfiguration } from "./config.js";
import { reviewerAgentName, reviewerTools } from "./reviewer-agent.js";
import { reviewerPrompt } from "./reviewer-prompt.js";
import { parseVerdict, responseText, sessionIdentifier } from "./reviewer-response.js";
import { withTimeout } from "./reviewer-timeout.js";

export type ReviewRequest = {
  source: "permission-request" | "tool-call";
  sessionID: string;
  action: string;
  resource: unknown;
  userIntent?: UserIntent;
  model?: ModelReference;
};

import type { UserIntent } from "./user-intent.js";

export type ReviewVerdict = {
  verdict: "allow" | "deny" | "escalate";
  reason: string;
};

export type ReviewSessionClient = {
  session: {
    create(input: { body: { title: string }; query: { directory: string } }): Promise<unknown>;
    delete(input: { path: { id: string }; query: { directory: string } }): Promise<unknown>;
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
    const session = await this.#client.session.create({
      body: { title: "opencode-auto-approve-reviewer" },
      query: { directory: this.#directory },
    });
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
      try {
        await this.#client.session.abort?.({
          path: { id: sessionID },
          query: { directory: this.#directory },
        });
      } catch {
        // Preserve the original review error if aborting also fails.
      }
      throw error;
    } finally {
      try {
        await this.#client.session.delete({
          path: { id: sessionID },
          query: { directory: this.#directory },
        });
      } catch {
        // Session cleanup is best-effort and must not change the review result.
      } finally {
        this.#reviewerSessionIDs.delete(sessionID);
      }
    }
  }
}
