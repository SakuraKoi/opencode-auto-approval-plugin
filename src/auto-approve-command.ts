import type { Notification } from "./plugin-notifications.ts";

type AutoApproveCommandDependencies = {
  notify(input: Notification): Promise<void>;
};

type CommandInput = {
  arguments: string;
  sessionID: string;
};

export function createAutoApproveCommandHandler(input: AutoApproveCommandDependencies) {
  let enabled = false;

  return {
    execute: async (command: CommandInput): Promise<void> => {
      const value = command.arguments.trim();
      if (value !== "true" && value !== "false") {
        enabled = !enabled;
      } else {
        enabled = value === "true";
      }
      await input.notify({
        sessionID: command.sessionID,
        message: `Auto-approval reviewer ${enabled ? "enabled" : "disabled"}.`,
        variant: "success",
      });
    },
    isEnabled: () => enabled,
    disable: () => {
      enabled = false;
    },
  };
}
