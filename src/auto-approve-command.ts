import type { ToastVariant } from "./plugin-notifications.js";

type AutoApproveCommandDependencies = {
  notify(input: { message: string; variant: ToastVariant }): Promise<void>;
};

export function createAutoApproveCommandHandler(input: AutoApproveCommandDependencies) {
  let enabled = false;

  return {
    execute: async (event: { arguments: string }, output: { parts: unknown[] }): Promise<never> => {
      output.parts.splice(0);
      const value = event.arguments.trim();
      if (value !== "true" && value !== "false") {
        enabled = !enabled;
      } else {
        enabled = value === "true";
      }
      await input.notify({
        message: `Auto-approval reviewer ${enabled ? "enabled" : "disabled"}.`,
        variant: "success",
      });

      // OpenCode 1.18 calls the agent even with no parts, so abort after handling the command.
      throw new Error("Auto-approve command handled.");
    },
    isEnabled: () => enabled,
  };
}
