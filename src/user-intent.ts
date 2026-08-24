import type { Event, Todo } from "@opencode-ai/sdk";

export type UserIntent = {
  title?: string;
  lastMessage: string | null;
  todos?: Todo[];
};

export function textFromParts(parts: unknown[]): string {
  return parts
    .flatMap((part) => (isRecord(part) && typeof part.text === "string" ? [part.text] : []))
    .join("\n");
}

export function updateIntentFromEvent(input: {
  event: Event;
  intents: Map<string, UserIntent>;
}): boolean {
  if (input.event.type === "session.created" || input.event.type === "session.updated") {
    const session = input.event.properties.info;
    const current = input.intents.get(session.id);
    input.intents.set(session.id, {
      ...(session.title ? { title: session.title } : {}),
      lastMessage: current?.lastMessage ?? null,
      ...(current?.todos ? { todos: current.todos } : {}),
    });
    return true;
  }

  if (input.event.type !== "todo.updated") return false;

  const current = input.intents.get(input.event.properties.sessionID);
  input.intents.set(input.event.properties.sessionID, {
    ...(current?.title === undefined ? {} : { title: current.title }),
    lastMessage: current?.lastMessage ?? null,
    ...(input.event.properties.todos.length > 0 ? { todos: input.event.properties.todos } : {}),
  });
  return true;
}

function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null;
}
