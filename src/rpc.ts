import { Rpc } from "@opencode/plugin";

const notifySchema = {
  type: "object",
  properties: {
    sessionID: { type: "string" },
    message: { type: "string" },
    variant: { type: "string" },
  },
  required: ["sessionID", "message", "variant"],
  additionalProperties: false,
} as const;

const emptyInputSchema = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const stateSchema = {
  type: "object",
  properties: {
    mode: { type: "string", enum: ["off", "review", "yolo"] },
  },
  required: ["mode"],
  additionalProperties: false,
} as const;

/**
 * Contract between the server plugin and the TUI part. The TUI subscribes to `notify` for toasts,
 * reads `getState` on startup, and follows `state` to keep the sidebar indicator current.
 */
export const AutoApprovalRpc = Rpc.define({
  id: "auto-approval",
  methods: {
    getState: {
      input: emptyInputSchema,
      output: stateSchema,
    },
  },
  events: {
    notify: { schema: notifySchema },
    state: { schema: stateSchema },
  },
});

export type AutoApprovalRpc = typeof AutoApprovalRpc;

export type AutoApprovalNotification = {
  sessionID: string;
  message: string;
  variant: string;
};

export type AutoApprovalMode = "off" | "review" | "yolo";

export type AutoApprovalState = {
  mode: AutoApprovalMode;
};
