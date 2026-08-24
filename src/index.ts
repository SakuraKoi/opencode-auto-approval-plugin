import type { Plugin, PluginOptions } from "@opencode-ai/plugin";
import { OpencodeClient as PermissionClient } from "@opencode-ai/sdk/v2/client";

import { parsePluginConfiguration, type ModelReference } from "./config.js";
import { Reviewer, reviewerAgent, type ReviewSessionClient } from "./reviewer.js";

type PermissionRequest = {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
};

type AutoApprovalPluginDependencies = {
  createReviewer(input: {
    client: ReviewSessionClient;
    directory: string;
    options: PluginOptions;
  }): Reviewer;
  replyToPermission(input: {
    client: unknown;
    directory: string;
    message?: string;
    reply: "once" | "reject";
    requestID: string;
  }): Promise<void>;
};

const defaultDependencies: AutoApprovalPluginDependencies = {
  createReviewer: (input) =>
    new Reviewer({
      client: input.client,
      directory: input.directory,
      configuration: parsePluginConfiguration(input.options),
    }),
  replyToPermission: async (input) => {
    const response = await permissionClient(input.client).permission.reply({
      directory: input.directory,
      ...(input.message === undefined ? {} : { message: input.message }),
      reply: input.reply,
      requestID: input.requestID,
    });
    if (response.error) {
      throw new Error(`Failed to reply to permission request: ${JSON.stringify(response.error)}`);
    }
  },
};

export function createAutoApprovalPlugin(
  input: {
    dependencies?: Partial<AutoApprovalPluginDependencies>;
  } = {},
): Plugin {
  const dependencies = { ...defaultDependencies, ...input.dependencies };

  return async (context, options = {}) => {
    const reviewer = dependencies.createReviewer({
      client: context.client as unknown as ReviewSessionClient,
      directory: context.directory,
      options,
    });
    const configuration = parsePluginConfiguration(options);
    const models = new Map<string, ModelReference>();
    const intents = new Map<string, string>();
    let enabled = false;

    return {
      config: async (config) => {
        config.agent ??= {};
        config.agent["auto-approval-reviewer"] = reviewerAgent();
        config.command ??= {};
        config.command["auto-approve"] = {
          description: "Enable or disable the auto-approval reviewer.",
          template: "$ARGUMENTS",
        };
      },
      "command.execute.before": async (event, output) => {
        if (event.command !== "auto-approve") return;

        const value = event.arguments.trim();
        if (value !== "true" && value !== "false") {
          output.parts = [
            commandMessagePart({
              sessionID: event.sessionID,
              text: "Usage: /auto-approve <true|false>",
            }),
          ];
          return;
        }

        enabled = value === "true";
        output.parts = [
          commandMessagePart({
            sessionID: event.sessionID,
            text: `Auto-approval reviewer ${enabled ? "enabled" : "disabled"}.`,
          }),
        ];
      },
      "chat.message": (event, output) => {
        if (event.model) models.set(event.sessionID, event.model);
        intents.set(event.sessionID, textFromParts(output.parts));
        return Promise.resolve();
      },
      "chat.params": (event) => {
        models.set(event.sessionID, {
          providerID: event.model.providerID,
          modelID: event.model.id,
        });
        return Promise.resolve();
      },
      event: async ({ event }) => {
        const permissionEvent = event as unknown as {
          properties: PermissionRequest;
          type: string;
        };
        if (
          !enabled ||
          configuration.mode !== "on-ask" ||
          permissionEvent.type !== "permission.asked"
        )
          return;

        const request = permissionEvent.properties;
        if (reviewer.isReviewerSession({ sessionID: request.sessionID })) return;

        try {
          const decision = await reviewer.review({
            source: "permission-request",
            sessionID: request.sessionID,
            action: request.permission,
            resource: { patterns: request.patterns, metadata: request.metadata },
            userIntent: intents.get(request.sessionID),
            model: models.get(request.sessionID),
          });
          if (decision.verdict === "escalate") return;
          await dependencies.replyToPermission({
            client: context.client,
            directory: context.directory,
            ...(decision.verdict === "deny"
              ? { message: decision.reason, reply: "reject" }
              : { reply: "once" }),
            requestID: request.id,
          });
        } catch {
          // Fail closed: preserve the original human permission prompt.
        }
      },
      "tool.execute.before": async (event, output) => {
        if (
          !enabled ||
          configuration.mode !== "all-tools" ||
          reviewer.isReviewerSession({ sessionID: event.sessionID })
        )
          return;

        let decision;
        try {
          decision = await reviewer.review({
            source: "tool-call",
            sessionID: event.sessionID,
            action: event.tool,
            resource: output.args,
            userIntent: intents.get(event.sessionID),
            model: models.get(event.sessionID),
          });
        } catch (error) {
          throw new Error(
            `Auto-approval reviewer failed; human review is required. ${errorMessage(error)}`,
            { cause: error },
          );
        }

        if (decision.verdict === "allow") return;
        const outcome = decision.verdict === "deny" ? "denied" : "requires human review";
        throw new Error(`Auto-approval reviewer ${outcome}: ${decision.reason}`);
      },
    };
  };
}

function textFromParts(parts: unknown[]): string {
  return parts
    .flatMap((part) => (isRecord(part) && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
}

function errorMessage(input: unknown): string {
  return input instanceof Error ? input.message : String(input);
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}

function permissionClient(input: unknown): PermissionClient {
  if (!isRecord(input) || !isRecord(input._client)) {
    throw new Error("OpenCode plugin client did not expose its SDK transport.");
  }
  return new PermissionClient({
    client: input._client as NonNullable<
      ConstructorParameters<typeof PermissionClient>[0]
    >["client"],
  });
}

function commandMessagePart(input: { sessionID: string; text: string }): {
  id: string;
  messageID: string;
  sessionID: string;
  text: string;
  type: "text";
} {
  return {
    id: "auto-approval-command",
    messageID: "auto-approval-command",
    sessionID: input.sessionID,
    text: input.text,
    type: "text",
  };
}

export default createAutoApprovalPlugin();
