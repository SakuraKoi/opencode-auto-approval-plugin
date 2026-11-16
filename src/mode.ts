import type { AutoApprovalMode } from "./rpc.ts";

/**
 * The mode the sidebar indicator shows. Yolo wins when both commands are somehow enabled, because
 * the permission hook checks it first.
 */
export function autoApprovalMode(input: { autoReview: boolean; yolo: boolean }): AutoApprovalMode {
  if (input.yolo) return "yolo";
  if (input.autoReview) return "review";
  return "off";
}
