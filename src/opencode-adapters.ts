import type { PluginOptions } from "@opencode-ai/plugin";
import { OpencodeClient as PermissionClient } from "@opencode-ai/sdk/v2/client";

import { parsePluginConfiguration } from "./config.js";
import { type ToastVariant } from "./plugin-notifications.js";
import { Reviewer, type ReviewSessionClient } from "./reviewer.js";

export type AutoApprovalPluginDependencies = {
  createReviewer(input: {
    client: ReviewSessionClient;
    directory: string;
    options: PluginOptions;
  }): Reviewer;
  replyToPermission(input: {
    client: unknown;
    directory: string;
    message?: string;
    reply: "once" | "reject";
    requestID: string;
  }): Promise<void>;
  showToast(input: {
    client: unknown;
    directory: string;
    message: string;
    variant: ToastVariant;
  }): Promise<void>;
};

export const defaultDependencies: AutoApprovalPluginDependencies = {
  createReviewer: (input) =>
    new Reviewer({
      client: input.client,
      directory: input.directory,
      configuration: parsePluginConfiguration(input.options),
    }),
  replyToPermission: async (input) => {
    const response = await permissionClient(input.client).permission.reply({
      directory: input.directory,
      ...(input.message === undefined ? {} : { message: input.message }),
      reply: input.reply,
      requestID: input.requestID,
    });
    if (response.error) {
      throw new Error(`Failed to reply to permission request: ${JSON.stringify(response.error)}`);
    }
  },
  showToast: async (input) => {
    if (!isRecord(input.client) || !isRecord(input.client.tui)) {
      throw new Error("OpenCode plugin client did not expose its TUI transport.");
    }

    const tui = input.client.tui as {
      showToast(options: {
        body: {
          message: string;
          variant: ToastVariant;
        };
        query: { directory: string };
      }): Promise<unknown>;
    };
    await tui.showToast({
      body: {
        message: input.message,
        variant: input.variant,
      },
      query: { directory: input.directory },
    });
  },
};

function permissionClient(input: unknown): PermissionClient {
  if (!isRecord(input) || !isRecord(input._client)) {
    throw new Error("OpenCode plugin client did not expose its SDK transport.");
  }
  return new PermissionClient({
    client: input._client as NonNullable<
      ConstructorParameters<typeof PermissionClient>[0]
    >["client"],
  });
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}
