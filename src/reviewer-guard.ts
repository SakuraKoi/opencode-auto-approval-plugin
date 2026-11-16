import { isReviewerToolAllowed } from "./reviewer-agent.ts";

/** Throws when a reviewer session attempts to use a tool outside the read-only allowlist. */
export function assertReviewerTool(tool: string): void {
  if (!isReviewerToolAllowed(tool)) {
    throw new Error(`The reviewer may not use the ${tool} tool.`);
  }
}
