/** @jsxImportSource @opentui/solid */
import { usePlugin } from "@opencode/plugin/tui";
import type { Context } from "@opencode/plugin/tui/context";
import { Show, type Accessor } from "solid-js";

import type { AutoApprovalMode } from "./rpc.ts";

/**
 * The mode pill above the sidebar footer. It renders nothing while both `/auto-approve` and
 * `/yolo` are off, so the sidebar keeps its usual height.
 */
function AutoApprovalIndicator(props: { mode: Accessor<AutoApprovalMode> }) {
  const context = usePlugin();

  return (
    <Show when={props.mode() !== "off"}>
      <box paddingLeft={1} paddingRight={1}>
        <text
          fg={
            props.mode() === "yolo"
              ? context.theme.text.feedback.warning.base
              : context.theme.text.feedback.info.base
          }
        >
          {props.mode() === "yolo" ? "Yolo" : "Auto Review"}
        </text>
      </box>
    </Show>
  );
}

/** Claims the sidebar slot; `prepend` keeps the indicator above the built-in footer rows. */
export function claimAutoApprovalIndicator(context: Context, mode: Accessor<AutoApprovalMode>) {
  return context.ui.slot({
    prepend: "sidebar.footer",
    render: () => <AutoApprovalIndicator mode={mode} />,
  });
}
