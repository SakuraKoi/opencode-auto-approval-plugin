import { describe, expect, it, vi } from "vitest";

import { createAutoApprovalPlugin } from "./index.js";
type ReviewerVerdict = "allow" | "deny" | "escalate";

function createContext() {
  return {
    context: {
      client: {},
      directory: "/workspace",
    },
  };
}

function createPlugin(input: { reviewError?: Error; verdict: ReviewerVerdict }) {
  const review = vi.fn(async () => {
    if (input.reviewError) throw input.reviewError;
    return { verdict: input.verdict, reason: "reviewed" };
  });
  const isReviewerSession = vi.fn(() => false);
  const replyToPermission = vi.fn(async () => undefined);
  const showToast = vi.fn(async () => undefined);
  const plugin = createAutoApprovalPlugin({
    dependencies: {
      createReviewer: () => ({ review, isReviewerSession }) as never,
      replyToPermission,
      showToast,
    },
  });
  return { plugin, review, isReviewerSession, replyToPermission, showToast };
}

function permissionAskedEvent(input: { id: string }) {
  return {
    event: {
      type: "permission.asked" as never,
      properties: {
        id: input.id,
        sessionID: "session-1",
        permission: "bash",
        patterns: ["git status"],
        metadata: {},
        always: [],
      },
    },
  };
}

async function enableReviewer(
  hooks: Awaited<ReturnType<ReturnType<typeof createAutoApprovalPlugin>>>,
) {
  const parts = [{ type: "text", text: "true" }];
  const output = { parts };
  await expect(
    hooks["command.execute.before"]?.(
      { command: "auto-approve", sessionID: "session-1", arguments: "true" },
      output as never,
    ),
  ).rejects.toThrow("Auto-approve command handled.");
  expect(output.parts).toBe(parts);
  expect(parts).toEqual([]);
}

describe("auto approval plugin", () => {
  it("registers the auto-approve command and starts disabled", async () => {
    const { context } = createContext();
    const { plugin, review } = createPlugin({ verdict: "allow" });
    const hooks = await plugin(context as never, { mode: "on-ask" });
    const config = {} as { agent?: Record<string, unknown>; command?: Record<string, unknown> };

    await hooks.config?.(config as never);
    await hooks.event?.(permissionAskedEvent({ id: "permission-1" }) as never);

    expect(config.command?.["auto-approve"]).toEqual({
      description: "Enable or disable the auto-approval reviewer.",
      template: "$ARGUMENTS",
    });
    expect(review).not.toHaveBeenCalled();
  });

  it("enables and disables the reviewer through the command", async () => {
    const { context } = createContext();
    const { plugin, review, showToast } = createPlugin({ verdict: "allow" });
    const hooks = await plugin(context as never, {});

    await enableReviewer(hooks);
    expect(showToast).toHaveBeenCalledWith({
      client: context.client,
      directory: context.directory,
      message: "Auto-approval reviewer enabled.",
      variant: "success",
    });
    await hooks.event?.(permissionAskedEvent({ id: "permission-1" }) as never);
    expect(review).toHaveBeenCalledOnce();

    const parts = [{ type: "text", text: "false" }];
    const output = { parts };
    await expect(
      hooks["command.execute.before"]?.(
        { command: "auto-approve", sessionID: "session-1", arguments: "false" },
        output as never,
      ),
    ).rejects.toThrow("Auto-approve command handled.");
    expect(output.parts).toBe(parts);
    expect(parts).toEqual([]);
    expect(showToast).toHaveBeenLastCalledWith({
      client: context.client,
      directory: context.directory,
      message: "Auto-approval reviewer disabled.",
      variant: "success",
    });
    await hooks.event?.(permissionAskedEvent({ id: "permission-2" }) as never);
    expect(review).toHaveBeenCalledOnce();
  });

  it("returns usage for an invalid command argument without changing state", async () => {
    const { context } = createContext();
    const { plugin, review, showToast } = createPlugin({ verdict: "allow" });
    const hooks = await plugin(context as never, {});
    const parts = [{ type: "text", text: "yes" }];
    const output = { parts };

    await expect(
      hooks["command.execute.before"]?.(
        { command: "auto-approve", sessionID: "session-1", arguments: "yes" },
        output as never,
      ),
    ).rejects.toThrow("Auto-approve command handled.");
    await hooks.event?.(permissionAskedEvent({ id: "permission-1" }) as never);

    expect(output.parts).toBe(parts);
    expect(parts).toEqual([]);
    expect(showToast).toHaveBeenCalledWith({
      client: context.client,
      directory: context.directory,
      message: "Usage: /auto-approve <true|false>",
      variant: "warning",
    });
    expect(review).not.toHaveBeenCalled();
  });

  it("auto-approves an ask request and shows the reviewer reason", async () => {
    const { context } = createContext();
    const { plugin, review, replyToPermission, showToast } = createPlugin({ verdict: "allow" });
    const hooks = await plugin(context as never, {});
    await enableReviewer(hooks);

    await hooks.event?.(permissionAskedEvent({ id: "permission-1" }) as never);

    expect(review).toHaveBeenCalledOnce();
    expect(replyToPermission).toHaveBeenCalledWith({
      client: {},
      directory: "/workspace",
      reply: "once",
      requestID: "permission-1",
    });
    expect(showToast).toHaveBeenLastCalledWith({
      client: context.client,
      directory: context.directory,
      message: "[Auto-approval] reviewer allowed `bash`\n\nreviewed",
      variant: "success",
    });
  });

  it("leaves an ask request for a human and shows a toast when the reviewer escalates", async () => {
    const { context } = createContext();
    const { plugin, replyToPermission, showToast } = createPlugin({ verdict: "escalate" });
    const hooks = await plugin(context as never, {});
    await enableReviewer(hooks);

    await hooks.event?.(permissionAskedEvent({ id: "permission-1" }) as never);

    expect(replyToPermission).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenLastCalledWith({
      client: context.client,
      directory: context.directory,
      message: "[Auto-approval] reviewer escalated `bash`\n\nreviewed",
      variant: "warning",
    });
  });

  it("leaves an ask request for a human and shows a toast when reviewing fails", async () => {
    const { context } = createContext();
    const { plugin, replyToPermission, showToast } = createPlugin({
      reviewError: new Error("review failed"),
      verdict: "allow",
    });
    const hooks = await plugin(context as never, {});
    await enableReviewer(hooks);

    await hooks.event?.(permissionAskedEvent({ id: "permission-1" }) as never);

    expect(replyToPermission).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenLastCalledWith({
      client: context.client,
      directory: context.directory,
      message: "[Auto-approval] reviewer failed for `bash`\n\nreview failed",
      variant: "error",
    });
  });

  it("rejects an ask request and shows the reviewer reason when the reviewer denies it", async () => {
    const { context } = createContext();
    const { plugin, replyToPermission, showToast } = createPlugin({ verdict: "deny" });
    const hooks = await plugin(context as never, {});
    await enableReviewer(hooks);

    await hooks.event?.(permissionAskedEvent({ id: "permission-1" }) as never);

    expect(replyToPermission).toHaveBeenCalledWith({
      client: {},
      directory: "/workspace",
      message: "reviewed",
      reply: "reject",
      requestID: "permission-1",
    });
    expect(showToast).toHaveBeenLastCalledWith({
      client: context.client,
      directory: context.directory,
      message: "[Auto-approval] reviewer denied `bash`\n\nreviewed",
      variant: "warning",
    });
  });

  it("blocks an allow-listed tool when all-tools review escalates", async () => {
    const { context } = createContext();
    const { plugin, showToast } = createPlugin({ verdict: "escalate" });
    const hooks = await plugin(context as never, { mode: "all-tools" });
    await enableReviewer(hooks);

    await expect(
      hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "session-1", callID: "call-1" },
        { args: { command: "git push" } },
      ),
    ).rejects.toThrow("requires human review");
    expect(showToast).toHaveBeenLastCalledWith({
      client: context.client,
      directory: context.directory,
      message: "[Auto-approval] reviewer escalated `bash`\n\nreviewed",
      variant: "warning",
    });
  });

  it("provides the latest user message and model todos to the reviewer", async () => {
    const { context } = createContext();
    const { plugin, review } = createPlugin({ verdict: "allow" });
    const hooks = await plugin(context as never, { mode: "all-tools" });
    await enableReviewer(hooks);

    await hooks.event?.({
      event: {
        type: "session.created",
        properties: {
          info: { id: "session-1", title: "Refactor auto-approval context" },
        },
      },
    } as never);
    await hooks["chat.message"]?.(
      {
        sessionID: "session-1",
        model: { providerID: "openai", modelID: "gpt-5.6" },
      },
      { parts: [{ type: "text", text: "Refactor the permission context." }] } as never,
    );
    await hooks.event?.({
      event: {
        type: "todo.updated",
        properties: {
          sessionID: "session-1",
          todos: [
            {
              id: "todo-1",
              content: "Update the reviewer request",
              status: "in_progress",
              priority: "high",
            },
          ],
        },
      },
    });

    await hooks["tool.execute.before"]?.(
      { tool: "edit", sessionID: "session-1", callID: "call-1" },
      { args: { filePath: "src/reviewer.ts" } },
    );
    expect(review).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userIntent: {
          title: "Refactor auto-approval context",
          lastMessage: "Refactor the permission context.",
          todos: [
            {
              id: "todo-1",
              content: "Update the reviewer request",
              status: "in_progress",
              priority: "high",
            },
          ],
        },
      }),
    );

    await hooks["chat.message"]?.({ sessionID: "session-1" }, {
      parts: [{ type: "text", text: "Also update the tests." }],
    } as never);
    await hooks.event?.({
      event: {
        type: "session.updated",
        properties: {
          info: { id: "session-1", title: "Refactor reviewer tests" },
        },
      },
    } as never);
    await hooks["tool.execute.before"]?.(
      { tool: "edit", sessionID: "session-1", callID: "call-2" },
      { args: { filePath: "src/index.test.ts" } },
    );
    expect(review).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userIntent: {
          title: "Refactor reviewer tests",
          lastMessage: "Also update the tests.",
          todos: [
            {
              id: "todo-1",
              content: "Update the reviewer request",
              status: "in_progress",
              priority: "high",
            },
          ],
        },
      }),
    );

    await hooks.event?.({
      event: {
        type: "todo.updated",
        properties: { sessionID: "session-1", todos: [] },
      },
    });
    await hooks["tool.execute.before"]?.(
      { tool: "read", sessionID: "session-1", callID: "call-3" },
      { args: { filePath: "src/index.ts" } },
    );
    expect(review).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userIntent: {
          title: "Refactor reviewer tests",
          lastMessage: "Also update the tests.",
        },
      }),
    );

    await hooks.event?.({
      event: {
        type: "session.deleted",
        properties: { info: { id: "session-1" } },
      },
    } as never);
    await hooks["tool.execute.before"]?.(
      { tool: "read", sessionID: "session-1", callID: "call-4" },
      { args: { filePath: "README.md" } },
    );
    expect(review).toHaveBeenLastCalledWith({
      source: "tool-call",
      sessionID: "session-1",
      action: "read",
      resource: { filePath: "README.md" },
      userIntent: undefined,
      model: undefined,
    });
  });

  it("blocks an allow-listed tool and shows a toast when reviewing fails", async () => {
    const { context } = createContext();
    const { plugin, showToast } = createPlugin({
      reviewError: new Error("review failed"),
      verdict: "allow",
    });
    const hooks = await plugin(context as never, { mode: "all-tools" });
    await enableReviewer(hooks);

    await expect(
      hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "session-1", callID: "call-1" },
        { args: { command: "git push" } },
      ),
    ).rejects.toThrow("review failed");
    expect(showToast).toHaveBeenLastCalledWith({
      client: context.client,
      directory: context.directory,
      message: "[Auto-approval] reviewer failed for `bash`\n\nreview failed",
      variant: "error",
    });
  });

  it("permits an allow-listed tool and shows the reviewer reason when all-tools review allows it", async () => {
    const { context } = createContext();
    const { plugin, showToast } = createPlugin({ verdict: "allow" });
    const hooks = await plugin(context as never, { mode: "all-tools" });
    await enableReviewer(hooks);

    await expect(
      hooks["tool.execute.before"]?.(
        { tool: "read", sessionID: "session-1", callID: "call-1" },
        { args: { filePath: "README.md" } },
      ),
    ).resolves.toBeUndefined();
    expect(showToast).toHaveBeenLastCalledWith({
      client: context.client,
      directory: context.directory,
      message: "[Auto-approval] reviewer allowed `read`\n\nreviewed",
      variant: "success",
    });
  });

  it("shows the reviewer reason before blocking a tool denied in all-tools mode", async () => {
    const { context } = createContext();
    const { plugin, showToast } = createPlugin({ verdict: "deny" });
    const hooks = await plugin(context as never, { mode: "all-tools" });
    await enableReviewer(hooks);

    await expect(
      hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "session-1", callID: "call-1" },
        { args: { command: "git push" } },
      ),
    ).rejects.toThrow("Auto-approval reviewer denied: reviewed");
    expect(showToast).toHaveBeenLastCalledWith({
      client: context.client,
      directory: context.directory,
      message: "[Auto-approval] reviewer denied `bash`\n\nreviewed",
      variant: "warning",
    });
  });
});
