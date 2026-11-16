type TodoStatus = "pending" | "in_progress" | "completed" | "cancelled";

export type Todo = {
  content: string;
  status: TodoStatus;
};

/** The subset of transcript message fields the context builders rely on. */
type SessionMessagePart = {
  type: string;
  text?: string;
  name?: string;
  state?: { status?: string; input?: unknown };
};

export type SessionMessages = ReadonlyArray<{
  type: string;
  id?: string;
  text?: unknown;
  model?: { id?: string; providerID?: string; variant?: string };
  content?: ReadonlyArray<SessionMessagePart>;
}>;

const todoStatuses = new Set<string>(["pending", "in_progress", "completed", "cancelled"]);

function isTodoTool(name: string | undefined): boolean {
  return name === "todowrite" || name === "todo";
}

function asRecord(input: unknown): Record<string, unknown> | undefined {
  return typeof input === "object" && input !== null
    ? (input as Record<string, unknown>)
    : undefined;
}

function parseTodos(input: unknown): Todo[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const content = "content" in item ? item.content : undefined;
    const status = "status" in item ? item.status : undefined;
    if (typeof content !== "string" || typeof status !== "string") return [];
    if (!todoStatuses.has(status)) return [];
    return [{ content, status: status as TodoStatus }];
  });
}

/**
 * Reads the latest todo list from the transcript. V2 has no `todo.updated` event exposed to
 * plugins, so the current list is derived from the most recent completed `todowrite` call.
 */
export function todosFromMessages(messages: SessionMessages): Todo[] | undefined {
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.type !== "assistant" || !message.content) continue;
    for (let partIndex = message.content.length - 1; partIndex >= 0; partIndex--) {
      const part = message.content[partIndex];
      if (part?.type !== "tool" || !isTodoTool(part.name)) continue;
      if (part.state?.status !== "completed") continue;
      // The newest todo call is authoritative, even when it clears the list.
      const todos = parseTodos(asRecord(part.state.input)?.todos);
      return todos.length > 0 ? todos : undefined;
    }
  }
  return undefined;
}
