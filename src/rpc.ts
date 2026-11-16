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

/**
 * Contract between the server plugin and the TUI part. The TUI subscribes to `notify` and shows
 * each event as a toast.
 */
export const AutoApprovalRpc = Rpc.define({
  id: "auto-approval",
  methods: {},
  events: {
    notify: { schema: notifySchema },
  },
});

export type AutoApprovalRpc = typeof AutoApprovalRpc;

export type AutoApprovalNotification = {
  sessionID: string;
  message: string;
  variant: string;
};
