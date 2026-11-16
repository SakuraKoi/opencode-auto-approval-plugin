import { describe, expect, it } from "vitest";

import { createAutoApprovalPlugin } from "./index.ts";
import { applyReviewerContext } from "./reviewer-agent.ts";
import type { AutoApprovalState } from "./rpc.ts";

const originSessionID = "origin-session";
const reviewerSessionID = "reviewer-session";

type PermissionEvaluation = {
  sessionID: string;
  action: string;
  resources: readonly string[];
  metadata?: Record<string, unknown>;
  source?: { type: "tool"; messageID: string; id: string };
  effect: "allow" | "ask" | "deny";
  message?: string;
};

type ToolEvent = {
  tool: string;
  sessionID: string;
  agent: string;
  messageID: string;
  id: string;
  input: unknown;
};

type SessionContextRequest = {
  sessionID: string;
  model: { providerID: string; id: string; variant?: string };
  system: { type: "text"; text: string }[];
  tools: Record<string, { description: string; input: unknown }>;
  options: Record<string, unknown>;
};

type Notification = Record<string, unknown> & { sessionID: string; message: string };

function transcript() {
  return [
    {
      id: "user-message",
      type: "user",
      text: "Please clean up the generated build directory.",
    },
    {
      id: "message-1",
      type: "assistant",
      model: { providerID: "anthropic", id: "origin-model", variant: "thinking" },
      content: [
        {
          type: "tool",
          name: "todowrite",
          state: {
            status: "completed",
            input: {
              todos: [
                { content: "Inspect the build output", status: "completed" },
                { content: "Remove generated files", status: "in_progress" },
              ],
            },
          },
        },
      ],
    },
  ];
}

function createHarness(input: {
  options?: unknown;
  reviewerResponse?: string;
  transcript?: ReadonlyArray<Record<string, unknown>>;
}) {
  const notifications: Notification[] = [];
  const states: AutoApprovalState[] = [];
  const createdSessions: Record<string, unknown>[] = [];
  const removedSessions: string[] = [];
  const interruptedSessions: string[] = [];
  const disposed: string[] = [];
  const commands = new Map<
    string,
    { execute: (invocation: { sessionID: string; prompt: { text: string } }) => Promise<void> }
  >();

  let permissionHook: ((evaluation: PermissionEvaluation) => Promise<void>) | undefined;
  let toolHook: ((event: ToolEvent) => Promise<void>) | undefined;
  let sessionHook: ((request: SessionContextRequest) => Promise<void>) | undefined;
  let getState: (() => Promise<AutoApprovalState>) | undefined;
  let duringReview: ((sessionID: string) => Promise<void> | void) | undefined;

  const originMessages = input.transcript ?? transcript();
  const reviewerMessages = [
    {
      id: "reviewer-message",
      type: "assistant",
      content: [
        {
          type: "text",
          text: input.reviewerResponse ?? '{"verdict":"allow","reason":"safe to run"}',
        },
      ],
    },
  ];

  function registration(name: string) {
    return { dispose: async () => void disposed.push(name) };
  }

  const context = {
    location: { directory: "/workspace" },
    options: input.options ?? {},
    permission: {
      hook: async (name: string, callback: typeof permissionHook) => {
        permissionHook = callback;
        return registration(`permission:${name}`);
      },
    },
    tool: {
      hook: async (name: string, callback: typeof toolHook) => {
        toolHook = callback;
        return registration(`tool:${name}`);
      },
    },
    session: {
      hook: async (name: string, callback: typeof sessionHook) => {
        sessionHook = callback;
        return registration(`session:${name}`);
      },
      create: async (request: Record<string, unknown>) => {
        createdSessions.push(request);
        return { id: reviewerSessionID };
      },
      get: async () => ({ id: originSessionID, title: "Fix the build" }),
      context: async (request: { sessionID: string }) =>
        request.sessionID === reviewerSessionID ? reviewerMessages : originMessages,
      prompt: async (request: { sessionID: string; text: string }) => {
        if (duringReview) await duringReview(request.sessionID);
      },
      wait: async () => undefined,
      interrupt: async (request: { sessionID: string }) => {
        interruptedSessions.push(request.sessionID);
      },
      remove: async (request: { sessionID: string }) => {
        removedSessions.push(request.sessionID);
      },
      list: async () => ({ data: [], cursor: { next: null } }),
    },
    command: {
      transform: async (
        callback: (editor: {
          add: (definition: {
            name: string;
            execute: (invocation: { sessionID: string; prompt: { text: string } }) => Promise<void>;
          }) => void;
        }) => void,
      ) => {
        callback({ add: (definition) => void commands.set(definition.name, definition) });
        return registration("command");
      },
      reload: async () => undefined,
    },
    rpc: {
      register: async (
        _definition: unknown,
        handlers: { getState: () => Promise<AutoApprovalState> },
      ) => {
        getState = handlers.getState;
        return {
          events: {
            emit: async (name: string, data: unknown) => {
              if (name === "state") {
                states.push(data as AutoApprovalState);
                return;
              }
              notifications.push(data as Notification);
            },
          },
          dispose: async () => void disposed.push("rpc"),
        };
      },
    },
  };

  return {
    context,
    notifications,
    states,
    createdSessions,
    removedSessions,
    interruptedSessions,
    disposed,
    commands,
    getState: async () => {
      if (!getState) throw new Error("rpc handlers were not registered");
      return getState();
    },
    get permissionHook() {
      if (!permissionHook) throw new Error("permission hook was not registered");
      return permissionHook;
    },
    get toolHook() {
      if (!toolHook) throw new Error("tool hook was not registered");
      return toolHook;
    },
    get sessionHook() {
      if (!sessionHook) throw new Error("session hook was not registered");
      return sessionHook;
    },
    setDuringReview(callback: (sessionID: string) => Promise<void> | void) {
      duringReview = callback;
    },
  };
}

async function setup(input: {
  options?: unknown;
  reviewerResponse?: string;
  transcript?: ReadonlyArray<Record<string, unknown>>;
}) {
  const harness = createHarness(input);
  const cleanup = await createAutoApprovalPlugin().setup(harness.context as never);
  return { ...harness, cleanup };
}

function permissionRequest(input: Partial<PermissionEvaluation> = {}): PermissionEvaluation {
  return {
    sessionID: originSessionID,
    action: "bash",
    resources: ["rm -rf build"],
    metadata: { command: "rm -rf build" },
    source: { type: "tool", messageID: "message-1", id: "call-1" },
    effect: "ask",
    ...input,
  };
}

function toolEvent(input: Partial<ToolEvent> = {}): ToolEvent {
  return {
    tool: "bash",
    sessionID: originSessionID,
    agent: "build",
    messageID: "message-1",
    id: "call-1",
    input: { command: "rm -rf build" },
    ...input,
  };
}

async function runCommand(harness: Awaited<ReturnType<typeof setup>>, name: string, args = "") {
  const command = harness.commands.get(name);
  if (!command) throw new Error(`${name} command was not registered`);
  await command.execute({ sessionID: originSessionID, prompt: { text: args } });
}

async function enableAutoApprove(harness: Awaited<ReturnType<typeof setup>>) {
  await runCommand(harness, "auto-approve");
}

async function enableYolo(harness: Awaited<ReturnType<typeof setup>>) {
  await runCommand(harness, "yolo");
}

describe("createAutoApprovalPlugin", () => {
  it("leaves ask decisions untouched while disabled", async () => {
    const harness = await setup({});

    const evaluation = permissionRequest();
    await harness.permissionHook(evaluation);

    expect(evaluation.effect).toBe("ask");
    expect(harness.notifications).toEqual([]);
    expect(harness.createdSessions).toEqual([]);
  });

  it("leaves explicitly allowed decisions untouched", async () => {
    const harness = await setup({});
    await enableAutoApprove(harness);

    const evaluation = permissionRequest({ effect: "allow" });
    await harness.permissionHook(evaluation);

    expect(evaluation.effect).toBe("allow");
    expect(harness.createdSessions).toEqual([]);
  });

  it("auto-approves ask decisions with transcript context", async () => {
    const harness = await setup({});
    await enableAutoApprove(harness);
    expect(harness.notifications.at(-1)).toMatchObject({
      sessionID: originSessionID,
      message: "Auto-approval reviewer enabled.",
    });

    const evaluation = permissionRequest();
    await harness.permissionHook(evaluation);

    expect(evaluation.effect).toBe("allow");
    expect(harness.createdSessions[0]).toMatchObject({
      title: "opencode-auto-approve-reviewer",
      metadata: { autoApprovalReviewer: true },
      model: { providerID: "anthropic", id: "origin-model", variant: "thinking" },
    });
    expect(harness.notifications.at(-1)).toMatchObject({
      sessionID: originSessionID,
      variant: "success",
    });
    expect(harness.notifications.at(-1)?.message).toContain("reviewer allowed `bash`");
    expect(harness.notifications.at(-1)?.message).toContain("safe to run");
    expect(harness.removedSessions).toEqual([reviewerSessionID]);
  });

  it("denies when the reviewer denies", async () => {
    const harness = await setup({
      reviewerResponse: '{"verdict":"deny","reason":"destructive command"}',
    });
    await enableAutoApprove(harness);

    const evaluation = permissionRequest();
    await harness.permissionHook(evaluation);

    expect(evaluation.effect).toBe("deny");
    expect(evaluation.message).toBe("destructive command");
    expect(harness.notifications.at(-1)).toMatchObject({ variant: "warning" });
    expect(harness.notifications.at(-1)?.message).toContain("reviewer denied");
  });

  it("escalates by leaving the human prompt in place", async () => {
    const harness = await setup({
      reviewerResponse: '{"verdict":"escalate","reason":"needs a human"}',
    });
    await enableAutoApprove(harness);

    const evaluation = permissionRequest();
    await harness.permissionHook(evaluation);

    expect(evaluation.effect).toBe("ask");
    expect(evaluation.message).toBe("needs a human");
    expect(harness.notifications.at(-1)?.message).toContain("reviewer escalated");
  });

  it("fails closed when the reviewer fails", async () => {
    const harness = await setup({ reviewerResponse: "not JSON" });
    await enableAutoApprove(harness);

    const evaluation = permissionRequest();
    await harness.permissionHook(evaluation);

    expect(evaluation.effect).toBe("ask");
    expect(harness.interruptedSessions).toEqual([reviewerSessionID]);
    expect(harness.notifications.at(-1)).toMatchObject({ variant: "error" });
    expect(harness.notifications.at(-1)?.message).toContain("reviewer failed for `bash`");
  });

  it("lets yolo auto-approve without invoking the reviewer", async () => {
    const harness = await setup({});
    await enableYolo(harness);
    expect(harness.notifications.at(-1)?.message).toBe("Yolo mode enabled.");

    const evaluation = permissionRequest();
    await harness.permissionHook(evaluation);

    expect(evaluation.effect).toBe("allow");
    expect(harness.createdSessions).toEqual([]);
    expect(harness.notifications.at(-1)).toMatchObject({
      sessionID: originSessionID,
      message: "[Yolo] auto-accepted `bash`",
    });
  });

  it("keeps auto-approval and yolo mutually exclusive", async () => {
    const harness = await setup({});
    await enableYolo(harness);
    await enableAutoApprove(harness);

    const evaluation = permissionRequest();
    await harness.permissionHook(evaluation);

    expect(evaluation.effect).toBe("allow");
    expect(harness.createdSessions).toHaveLength(1);
    expect(harness.notifications.at(-1)?.message).toContain("reviewer allowed");
  });

  it("reports the current mode over rpc", async () => {
    const harness = await setup({});
    await expect(harness.getState()).resolves.toEqual({ mode: "off" });

    await enableAutoApprove(harness);
    await expect(harness.getState()).resolves.toEqual({ mode: "review" });

    await enableYolo(harness);
    await expect(harness.getState()).resolves.toEqual({ mode: "yolo" });
  });

  it("publishes the mode after each command", async () => {
    const harness = await setup({});
    expect(harness.states).toEqual([]);

    await enableAutoApprove(harness);
    expect(harness.states.at(-1)).toEqual({ mode: "review" });

    await enableYolo(harness);
    expect(harness.states.at(-1)).toEqual({ mode: "yolo" });

    await runCommand(harness, "yolo", "false");
    expect(harness.states.at(-1)).toEqual({ mode: "off" });
  });

  it("reviews tool calls in all-tools mode", async () => {
    const harness = await setup({ options: { mode: "all-tools" } });
    await enableAutoApprove(harness);

    await expect(harness.toolHook(toolEvent())).resolves.toBeUndefined();
    expect(harness.createdSessions).toHaveLength(1);
    expect(harness.notifications.at(-1)?.message).toContain("reviewer allowed `bash`");
  });

  it("blocks tool calls when the reviewer denies", async () => {
    const harness = await setup({
      options: { mode: "all-tools" },
      reviewerResponse: '{"verdict":"deny","reason":"destructive"}',
    });
    await enableAutoApprove(harness);

    await expect(harness.toolHook(toolEvent())).rejects.toThrow(
      "Auto-approval reviewer denied: destructive",
    );
  });

  it("blocks tool calls when the reviewer fails", async () => {
    const harness = await setup({ options: { mode: "all-tools" }, reviewerResponse: "not JSON" });
    await enableAutoApprove(harness);

    await expect(harness.toolHook(toolEvent())).rejects.toThrow(
      "Auto-approval reviewer failed; human review is required.",
    );
    expect(harness.notifications.at(-1)).toMatchObject({ variant: "error" });
  });

  it("does not review tool calls in on-ask mode", async () => {
    const harness = await setup({});
    await enableAutoApprove(harness);

    await expect(harness.toolHook(toolEvent())).resolves.toBeUndefined();
    expect(harness.createdSessions).toEqual([]);
  });

  it("restricts the reviewer session to a read-only allowlist", async () => {
    const harness = await setup({});
    await enableAutoApprove(harness);

    const reviewerEvaluations: PermissionEvaluation[] = [];
    harness.setDuringReview(async (sessionID) => {
      for (const action of ["write", "bash", "read"]) {
        const evaluation = permissionRequest({
          sessionID,
          action,
          resources: ["*"],
          effect: "ask",
        });
        await harness.permissionHook(evaluation);
        reviewerEvaluations.push(evaluation);
      }
    });

    await harness.permissionHook(permissionRequest());

    expect(reviewerEvaluations.map((evaluation) => evaluation.effect)).toEqual([
      "deny",
      "deny",
      "ask",
    ]);
    expect(reviewerEvaluations[0]?.message).toContain("may not use the write action");
    expect(harness.createdSessions).toHaveLength(1);
  });

  it("applies the reviewer persona and disables reasoning", async () => {
    const harness = await setup({
      options: {
        reviewer: { model: { providerID: "anthropic", modelID: "reviewer-model" } },
      },
    });
    await enableAutoApprove(harness);

    const requests: SessionContextRequest[] = [];
    harness.setDuringReview(async (sessionID) => {
      const request: SessionContextRequest = {
        sessionID,
        model: { providerID: "anthropic", id: "reviewer-model" },
        system: [],
        tools: {
          read: { description: "read", input: {} },
          write: { description: "write", input: {} },
          bash: { description: "bash", input: {} },
        },
        options: {},
      };
      await harness.sessionHook(request);
      requests.push(request);
    });

    await harness.permissionHook(permissionRequest());

    expect(requests).toHaveLength(1);
    const request = requests[0];
    expect(request?.system[0]?.text).toContain("read-only security reviewer");
    expect(Object.keys(request?.tools ?? {})).toEqual(["read"]);
    expect(request?.options).toEqual({ thinking: { type: "disabled" } });
  });

  it("filters reviewer tools through the shared helper", () => {
    const tools: Record<string, unknown> = { read: {}, glob: {}, grep: {}, edit: {} };
    applyReviewerContext({ system: [], tools });
    expect(Object.keys(tools)).toEqual(["read", "glob", "grep"]);
  });

  it("disposes every registration on cleanup", async () => {
    const harness = await setup({});

    await harness.cleanup?.();

    expect(harness.disposed).toEqual([
      "command",
      "permission:evaluate",
      "tool:execute.before",
      "session:context",
      "rpc",
    ]);
  });
});
