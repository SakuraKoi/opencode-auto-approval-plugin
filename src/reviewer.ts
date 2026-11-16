import type { Plugin } from "@opencode/plugin";

import type { ModelReference, PluginConfiguration } from "./config.ts";
import {
  reviewerMetadataKey,
  reviewerPermissions,
  reviewerSessionTitle,
  sessionModel,
} from "./reviewer-agent.ts";
import type { UserIntent } from "./reviewer-context.ts";
import { reviewerPrompt } from "./reviewer-prompt.ts";
import { parseVerdict, reviewerResponseText } from "./reviewer-response.ts";
import { withTimeout } from "./reviewer-timeout.ts";

export type ReviewRequest = {
  source: "permission-request" | "tool-call";
  sessionID: string;
  action: string;
  resource: unknown;
  userIntent?: UserIntent;
  model?: ModelReference;
};

export type ReviewVerdict = {
  verdict: "allow" | "deny" | "escalate";
  reason: string;
};

export class Reviewer {
  readonly #context: Plugin.Context;
  readonly #configuration: PluginConfiguration;
  readonly #reviewerSessionIDs = new Set<string>();

  constructor(input: { context: Plugin.Context; configuration: PluginConfiguration }) {
    this.#context = input.context;
    this.#configuration = input.configuration;
  }

  isReviewerSession(sessionID: string): boolean {
    return this.#reviewerSessionIDs.has(sessionID);
  }

  async review(input: ReviewRequest): Promise<ReviewVerdict> {
    const model = this.#configuration.reviewer.model ?? input.model;
    const session = await this.#context.session.create({
      title: reviewerSessionTitle,
      location: { directory: this.#context.location.directory },
      metadata: { [reviewerMetadataKey]: true },
      ...(model === undefined ? {} : { model: sessionModel(model) }),
      permissions: reviewerPermissions,
    });
    const sessionID = session.id;
    this.#reviewerSessionIDs.add(sessionID);

    try {
      const messages = await withTimeout({
        timeoutMs: this.#configuration.reviewer.timeoutMs,
        operation: this.#run({ sessionID, prompt: reviewerPrompt(input) }),
      });
      return parseVerdict(reviewerResponseText(messages));
    } catch (error) {
      try {
        await this.#context.session.interrupt({ sessionID });
      } catch {
        // Preserve the original review error if interrupting also fails.
      }
      throw error;
    } finally {
      try {
        await this.#context.session.remove({ sessionID });
      } catch {
        // Session cleanup is best-effort and must not change the review result.
      } finally {
        this.#reviewerSessionIDs.delete(sessionID);
      }
    }
  }

  /**
   * Removes reviewer sessions left behind by a previous process. Best-effort: a failure here
   * must never prevent the plugin from loading.
   */
  async reconcile(): Promise<void> {
    try {
      const sessions = await this.#context.session.list({
        directory: this.#context.location.directory,
        search: reviewerSessionTitle,
        limit: 100,
      });
      await Promise.all(
        sessions.data.map(async (session) => {
          if (session.title !== reviewerSessionTitle) return;
          if (session.metadata?.[reviewerMetadataKey] !== true) return;
          try {
            await this.#context.session.remove({ sessionID: session.id });
          } catch {
            // A stale session that cannot be removed is harmless.
          }
        }),
      );
    } catch {
      // Listing sessions is best-effort; continue loading the plugin.
    }
  }

  dispose(): void {
    this.#reviewerSessionIDs.clear();
  }

  async #run(input: { sessionID: string; prompt: string }) {
    await this.#context.session.prompt({ sessionID: input.sessionID, text: input.prompt });
    await this.#context.session.wait({ sessionID: input.sessionID });
    return await this.#context.session.context({ sessionID: input.sessionID });
  }
}
