import type { Notification } from "./plugin-notifications.ts";

type YoloCommandDependencies = {
  notify(input: Notification): Promise<void>;
};

type CommandInput = {
  arguments: string;
  sessionID: string;
};

export function createYoloCommandHandler(input: YoloCommandDependencies) {
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
        message: `Yolo mode ${enabled ? "enabled" : "disabled"}.`,
        variant: "success",
      });
    },
    isEnabled: () => enabled,
    disable: () => {
      enabled = false;
    },
  };
}
