import type { Plugin } from "@opencode-ai/plugin";

import { parsePluginConfiguration, type ModelReference } from "./config.js";
import { defaultDependencies, type AutoApprovalPluginDependencies } from "./opencode-adapters.js";
import {
  decisionNotification,
  errorMessage,
  failClosedNotification,
  type ToastVariant,
} from "./plugin-notifications.js";
import { reviewerAgent } from "./reviewer-agent.js";
import type { ReviewSessionClient, ReviewVerdict } from "./reviewer.js";
import { textFromParts, type UserIntent, updateIntentFromEvent } from "./user-intent.js";

type PermissionRequest = {
  id: string;
  sessionID: string;
  permission: string;
  patterns: string[];
  metadata: Record<string, unknown>;
};

const commandHandledMessage = "Auto-approve command handled.";

export function createAutoApprovalPlugin(
  input: { dependencies?: Partial<AutoApprovalPluginDependencies> } = {},
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
    const intents = new Map<string, UserIntent>();
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
        const current = intents.get(event.sessionID);
        intents.set(event.sessionID, {
          ...(current?.title === undefined ? {} : { title: current.title }),
          lastMessage: textFromParts(output.parts),
          ...(current?.todos ? { todos: current.todos } : {}),
        });
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
        if (updateIntentFromEvent({ event, intents })) return;

        if (event.type === "session.deleted") {
          models.delete(event.properties.info.id);
          intents.delete(event.properties.info.id);
          return;
        }

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

        let decision: ReviewVerdict;
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
      dispose: () => {
        models.clear();
        intents.clear();
        return Promise.resolve();
      },
    };
  };
}
