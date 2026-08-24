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

function createPlugin(input: { verdict: ReviewerVerdict }) {
  const review = vi.fn(async () => ({ verdict: input.verdict, reason: "reviewed" }));
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

  it("auto-approves an ask request only when the reviewer allows it", async () => {
    const { context } = createContext();
    const { plugin, review, replyToPermission } = createPlugin({ verdict: "allow" });
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
  });

  it("leaves an ask request for a human when the reviewer escalates", async () => {
    const { context } = createContext();
    const { plugin, replyToPermission } = createPlugin({ verdict: "escalate" });
    const hooks = await plugin(context as never, {});
    await enableReviewer(hooks);

    await hooks.event?.(permissionAskedEvent({ id: "permission-1" }) as never);

    expect(replyToPermission).not.toHaveBeenCalled();
  });

  it("rejects an ask request with the reviewer reason when the reviewer denies it", async () => {
    const { context } = createContext();
    const { plugin, replyToPermission } = createPlugin({ verdict: "deny" });
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
  });

  it("blocks an allow-listed tool when all-tools review escalates", async () => {
    const { context } = createContext();
    const { plugin } = createPlugin({ verdict: "escalate" });
    const hooks = await plugin(context as never, { mode: "all-tools" });
    await enableReviewer(hooks);

    await expect(
      hooks["tool.execute.before"]?.(
        { tool: "bash", sessionID: "session-1", callID: "call-1" },
        { args: { command: "git push" } },
      ),
    ).rejects.toThrow("requires human review");
  });

  it("permits an allow-listed tool when all-tools review allows it", async () => {
    const { context } = createContext();
    const { plugin } = createPlugin({ verdict: "allow" });
    const hooks = await plugin(context as never, { mode: "all-tools" });
    await enableReviewer(hooks);

    await expect(
      hooks["tool.execute.before"]?.(
        { tool: "read", sessionID: "session-1", callID: "call-1" },
        { args: { filePath: "README.md" } },
      ),
    ).resolves.toBeUndefined();
  });
});
