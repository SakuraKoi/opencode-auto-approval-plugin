import { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";

import { claimAutoApprovalIndicator } from "./mode-indicator.tsx";
import {
  AutoApprovalRpc,
  type AutoApprovalMode,
  type AutoApprovalNotification,
  type AutoApprovalState,
} from "./rpc.ts";

type ToastVariant = "info" | "success" | "warning" | "error";

const toastVariants = new Set<string>(["info", "success", "warning", "error"]);

function isToastVariant(input: unknown): input is ToastVariant {
  return typeof input === "string" && toastVariants.has(input);
}

function isAutoApprovalMode(input: unknown): input is AutoApprovalMode {
  return input === "off" || input === "review" || input === "yolo";
}

function isAutoApprovalState(input: unknown): input is AutoApprovalState {
  return (
    typeof input === "object" && input !== null && "mode" in input && isAutoApprovalMode(input.mode)
  );
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
    const [mode, setMode] = createSignal<AutoApprovalMode>("off");

    const offNotify = rpc.events.on("notify", (event) => {
      if (!matchesLocation(context.location, event.location)) return;

      const data = event.data as AutoApprovalNotification;
      context.ui.toast.show({
        title: "Auto-approval",
        message: data.message,
        ...(isToastVariant(data.variant) ? { variant: data.variant } : {}),
        sessionID: data.sessionID,
      });
    });

    const offState = rpc.events.on("state", (event) => {
      if (!matchesLocation(context.location, event.location)) return;
      if (isAutoApprovalState(event.data)) setMode(event.data.mode);
    });

    void rpc
      .getState({}, context.location ? { location: context.location } : undefined)
      .then((state) => {
        if (isAutoApprovalState(state)) setMode(state.mode);
      })
      .catch(() => {
        // The server plugin may still be loading; the next state event updates the indicator.
      });

    const offIndicator = claimAutoApprovalIndicator(context, mode);

    return () => {
      offNotify();
      offState();
      offIndicator();
    };
  },
});
