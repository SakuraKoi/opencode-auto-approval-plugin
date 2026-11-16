import { Plugin } from "@opencode/plugin/tui";

import { AutoApprovalRpc, type AutoApprovalNotification } from "./rpc.ts";

type ToastVariant = "info" | "success" | "warning" | "error";

const toastVariants = new Set<string>(["info", "success", "warning", "error"]);

function isToastVariant(input: unknown): input is ToastVariant {
  return typeof input === "string" && toastVariants.has(input);
}

function matchesLocation(
  current: { directory: string; workspaceID?: string } | undefined,
  event: { directory: string; workspaceID?: string },
): boolean {
  if (!current) return true;
  if (current.directory !== event.directory) return false;
  if (current.workspaceID && event.workspaceID) {
    return current.workspaceID === event.workspaceID;
  }
  return true;
}

export default Plugin.define({
  id: "auto-approval",
  setup(context) {
    const rpc = context.client.rpc(AutoApprovalRpc);
    return rpc.events.on("notify", (event) => {
      if (!matchesLocation(context.location, event.location)) return;

      const data = event.data as AutoApprovalNotification;
      context.ui.toast.show({
        title: "Auto-approval",
        message: data.message,
        ...(isToastVariant(data.variant) ? { variant: data.variant } : {}),
        sessionID: data.sessionID,
      });
    });
  },
});
