import type { Plugin, PluginOptions } from "@opencode-ai/plugin";
import { OpencodeClient as PermissionClient } from "@opencode-ai/sdk/v2/client";

import { type ModelReference, parsePluginConfiguration } from "./config.js";
import {
  Reviewer,
  reviewerAgent,
  type ReviewSessionClient,
  type ReviewVerdict,
} from "./reviewer.js";

type PermissionRequest = {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
};

type ToastVariant = "info" | "success" | "warning" | "error";

const commandHandledMessage = "Auto-approve command handled.";

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
  showToast(input: {
    client: unknown;
    directory: string;
    message: string;
    variant: ToastVariant;
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
  showToast: async (input) => {
    if (!isRecord(input.client) || !isRecord(input.client.tui)) {
      throw new Error("OpenCode plugin client did not expose its TUI transport.");
    }

    const tui = input.client.tui as {
      showToast(options: {
        body: {
          message: string;
          variant: ToastVariant;
        };
        query: { directory: string };
      }): Promise<unknown>;
    };
    await tui.showToast({
      body: {
        message: input.message,
        variant: input.variant,
      },
      query: { directory: input.directory },
    });
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
    const notify = async (notification: { message: string; variant: ToastVariant }) => {
      try {
        await dependencies.showToast({
          client: context.client,
          directory: context.directory,
          ...notification,
        });
      } catch {
        // Toasts are best-effort and must not affect command execution.
      }
    };

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

        output.parts.splice(0);
        const value = event.arguments.trim();
        if (value !== "true" && value !== "false") {
          await notify({
            message: "Usage: /auto-approve <true|false>",
            variant: "warning",
          });
          throw new Error(commandHandledMessage);
        }

        enabled = value === "true";
        await notify({
          message: `Auto-approval reviewer ${enabled ? "enabled" : "disabled"}.`,
          variant: "success",
        });
        // OpenCode 1.18 calls the agent even with no parts, so abort after handling the command.
        throw new Error(commandHandledMessage);
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
          if (decision.verdict === "escalate") {
            await notify(decisionNotification({ action: request.permission, decision }));
            return;
          }
          await dependencies.replyToPermission({
            client: context.client,
            directory: context.directory,
            ...(decision.verdict === "deny"
              ? { message: decision.reason, reply: "reject" }
              : { reply: "once" }),
            requestID: request.id,
          });
          await notify(decisionNotification({ action: request.permission, decision }));
        } catch (error) {
          await notify(failClosedNotification({ action: request.permission, error }));
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
          await notify(failClosedNotification({ action: event.tool, error }));
          throw new Error(
            `Auto-approval reviewer failed; human review is required. ${errorMessage(error)}`,
            { cause: error },
          );
        }

        await notify(decisionNotification({ action: event.tool, decision }));
        if (decision.verdict === "allow") return;
        const outcome = decision.verdict === "deny" ? "denied" : "requires human review";
        throw new Error(`Auto-approval reviewer ${outcome}: ${decision.reason}`);
      },
    };
  };
}

function decisionNotification(input: { action: string; decision: ReviewVerdict }): {
  message: string;
  variant: ToastVariant;
} {
  const outcome =
    input.decision.verdict === "allow"
      ? `allowed `
      : input.decision.verdict === "deny"
        ? `denied`
        : `escalated`;
  return {
    message: `[Auto-approval] reviewer ${outcome} \`${input.action}\`\n${input.decision.reason}`,
    variant: input.decision.verdict === "allow" ? "success" : "warning",
  };
}

function failClosedNotification(input: { action: string; error: unknown }): {
  message: string;
  variant: ToastVariant;
} {
  return {
    message: `[Auto-approval] reviewer failed for \`${input.action}\`\n${errorMessage(input.error)}`,
    variant: "error",
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

export default createAutoApprovalPlugin();
