import type { Plugin } from "@opencode/plugin";

import type { ModelReference } from "./config.ts";
import { todosFromMessages, type SessionMessages, type Todo } from "./todo-context.ts";

export type UserIntent = {
  title?: string;
  lastMessage: string | null;
  todos?: Todo[];
};

export type ReviewContext = {
  userIntent?: UserIntent;
  model?: ModelReference;
};

function lastUserMessage(messages: SessionMessages): string | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.type === "user") {
      const text = (message as { text?: unknown }).text;
      if (typeof text === "string") return text;
    }
  }
  return null;
}

function modelFromMessages(
  messages: SessionMessages,
  messageID: string,
): ModelReference | undefined {
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    if ((message as { id?: unknown }).id !== messageID) continue;
    const model = (message as { model?: { id?: string; providerID?: string; variant?: string } })
      .model;
    if (typeof model?.id !== "string" || typeof model.providerID !== "string") return undefined;
    return {
      providerID: model.providerID,
      modelID: model.id,
      ...(model.variant === undefined ? {} : { variant: model.variant }),
    };
  }
  return undefined;
}

/**
 * Builds the review input from the originating session's transcript. The model comes from the
 * assistant message that requested the operation, not from the session's current selection.
 */
export async function loadReviewContext(
  context: Plugin.Context,
  input: { sessionID: string; messageID?: string },
): Promise<ReviewContext> {
  const [session, messages] = await Promise.all([
    context.session.get({ sessionID: input.sessionID }).catch(() => undefined),
    context.session.context({ sessionID: input.sessionID }).catch(() => []),
  ]);

  const title = session?.title;
  const last = lastUserMessage(messages);
  const todos = todosFromMessages(messages);
  const hasIntent = title !== undefined || last !== null || todos !== undefined;

  const model = input.messageID ? modelFromMessages(messages, input.messageID) : undefined;

  return {
    ...(hasIntent
      ? {
          userIntent: {
            ...(title === undefined ? {} : { title }),
            lastMessage: last,
            ...(todos === undefined ? {} : { todos }),
          },
        }
      : {}),
    ...(model === undefined ? {} : { model }),
  };
}
