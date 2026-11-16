import { Plugin } from "@opencode/plugin";

import { createAutoApproveCommandHandler } from "./auto-approve-command.ts";
import { parsePluginConfiguration } from "./config.ts";
import { autoApprovalMode } from "./mode.ts";
import {
  decisionNotification,
  errorMessage,
  failClosedNotification,
  yoloAcceptNotification,
  type Notification,
} from "./plugin-notifications.ts";
import { applyReviewerContext, disableReasoning, isReviewerToolAllowed } from "./reviewer-agent.ts";
import { loadReviewContext } from "./reviewer-context.ts";
import { assertReviewerTool } from "./reviewer-guard.ts";
import { Reviewer, type ReviewVerdict } from "./reviewer.ts";
import { AutoApprovalRpc } from "./rpc.ts";
import { createYoloCommandHandler } from "./yolo-command.ts";

export function createAutoApprovalPlugin(): Plugin.Plugin {
  return Plugin.define({
    id: "auto-approval",
    async setup(context) {
      const configuration = parsePluginConfiguration(context.options ?? {});
      const reviewer = new Reviewer({ context, configuration });
      const rpc = await context.rpc.register(AutoApprovalRpc, {
        getState: async () => ({ mode: currentMode() }),
      });

      const notify = async (input: Notification): Promise<void> => {
        try {
          await rpc.events.emit("notify", input);
        } catch {
          // Toasts are best-effort and must not affect command or review behavior.
        }
      };

      const autoApproveCommand = createAutoApproveCommandHandler({ notify });
      const yoloCommand = createYoloCommandHandler({ notify });

      function currentMode() {
        return autoApprovalMode({
          autoReview: autoApproveCommand.isEnabled(),
          yolo: yoloCommand.isEnabled(),
        });
      }

      const publishState = async (): Promise<void> => {
        try {
          await rpc.events.emit("state", { mode: currentMode() });
        } catch {
          // The sidebar indicator is best-effort and must not affect command behavior.
        }
      };

      const permissionRegistration = await context.permission.hook(
        "evaluate",
        async (evaluation) => {
          if (reviewer.isReviewerSession(evaluation.sessionID)) {
            if (!isReviewerToolAllowed(evaluation.action)) {
              evaluation.effect = "deny";
              evaluation.message = `The reviewer may not use the ${evaluation.action} action.`;
            }
            return;
          }

          // Explicit allow rules are final. Only operations that would prompt are reviewed.
          if (evaluation.effect !== "ask") return;

          if (yoloCommand.isEnabled()) {
            evaluation.effect = "allow";
            await notify({
              sessionID: evaluation.sessionID,
              ...yoloAcceptNotification({ action: evaluation.action }),
            });
            return;
          }

          if (!autoApproveCommand.isEnabled() || configuration.mode !== "on-ask") return;

          try {
            const reviewContext = await loadReviewContext(context, {
              sessionID: evaluation.sessionID,
              ...(evaluation.source === undefined
                ? {}
                : { messageID: evaluation.source.messageID }),
            });
            const decision = await reviewer.review({
              source: "permission-request",
              sessionID: evaluation.sessionID,
              action: evaluation.action,
              resource: {
                resources: evaluation.resources,
                metadata: evaluation.metadata ?? null,
                source: evaluation.source ?? null,
              },
              ...(reviewContext.userIntent === undefined
                ? {}
                : { userIntent: reviewContext.userIntent }),
              ...(reviewContext.model === undefined ? {} : { model: reviewContext.model }),
            });

            if (decision.verdict === "allow") {
              evaluation.effect = "allow";
            } else if (decision.verdict === "deny") {
              evaluation.effect = "deny";
              evaluation.message = decision.reason;
            } else {
              // Escalating leaves the native permission prompt in place.
              evaluation.message = decision.reason;
            }

            await notify({
              sessionID: evaluation.sessionID,
              ...decisionNotification({ action: evaluation.action, decision }),
            });
          } catch (error) {
            // Fail closed: preserve the original human permission prompt.
            evaluation.effect = "ask";
            await notify({
              sessionID: evaluation.sessionID,
              ...failClosedNotification({ action: evaluation.action, error }),
            });
          }
        },
      );

      const toolRegistration = await context.tool.hook("execute.before", async (event) => {
        if (reviewer.isReviewerSession(event.sessionID)) {
          assertReviewerTool(event.tool);
          return;
        }

        if (yoloCommand.isEnabled()) {
          await notify({
            sessionID: event.sessionID,
            ...yoloAcceptNotification({ action: event.tool }),
          });
          return;
        }

        if (!autoApproveCommand.isEnabled() || configuration.mode !== "all-tools") return;

        let decision: ReviewVerdict;
        try {
          const reviewContext = await loadReviewContext(context, {
            sessionID: event.sessionID,
            messageID: event.messageID,
          });
          decision = await reviewer.review({
            source: "tool-call",
            sessionID: event.sessionID,
            action: event.tool,
            resource: event.input,
            ...(reviewContext.userIntent === undefined
              ? {}
              : { userIntent: reviewContext.userIntent }),
            ...(reviewContext.model === undefined ? {} : { model: reviewContext.model }),
          });
        } catch (error) {
          await notify({
            sessionID: event.sessionID,
            ...failClosedNotification({ action: event.tool, error }),
          });
          throw new Error(
            `Auto-approval reviewer failed; human review is required. ${errorMessage(error)}`,
            { cause: error },
          );
        }

        await notify({
          sessionID: event.sessionID,
          ...decisionNotification({ action: event.tool, decision }),
        });
        if (decision.verdict === "allow") return;

        const outcome = decision.verdict === "deny" ? "denied" : "requires human review";
        throw new Error(`Auto-approval reviewer ${outcome}: ${decision.reason}`);
      });

      const sessionRegistration = await context.session.hook("context", (request) => {
        if (!reviewer.isReviewerSession(request.sessionID)) return;
        applyReviewerContext(request);
        disableReasoning({ providerID: request.model.providerID, options: request.options });
      });

      const commandRegistration = await context.command.transform((editor) => {
        editor.add({
          name: "auto-approve",
          description: "Enable or disable the auto-approval reviewer.",
          execute: async (invocation) => {
            await autoApproveCommand.execute({
              arguments: invocation.prompt.text,
              sessionID: invocation.sessionID,
            });
            if (autoApproveCommand.isEnabled()) yoloCommand.disable();
            await publishState();
          },
        });
        editor.add({
          name: "yolo",
          description: "Automatically accept any permission request without review.",
          execute: async (invocation) => {
            await yoloCommand.execute({
              arguments: invocation.prompt.text,
              sessionID: invocation.sessionID,
            });
            if (yoloCommand.isEnabled()) autoApproveCommand.disable();
            await publishState();
          },
        });
      });
      await context.command.reload();

      await reviewer.reconcile();

      return async () => {
        reviewer.dispose();
        await commandRegistration.dispose();
        await permissionRegistration.dispose();
        await toolRegistration.dispose();
        await sessionRegistration.dispose();
        await rpc.dispose();
      };
    },
  });
}
