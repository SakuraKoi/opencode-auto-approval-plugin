import type { Plugin } from "@opencode/plugin";
import { describe, expect, it } from "vitest";

import { parsePluginConfiguration, type PluginConfiguration } from "./config.ts";
import { Reviewer } from "./reviewer.ts";
import type { SessionMessages } from "./todo-context.ts";

const reviewerSessionID = "reviewer-session";
const directory = "/workspace";

type HarnessInput = {
  configuration: PluginConfiguration;
  messages?: SessionMessages;
  removeError?: Error;
  wait?: "resolve" | "hang";
  list?: () => Promise<unknown>;
};

function createHarness(input: HarnessInput) {
  const created: Record<string, unknown>[] = [];
  const prompts: { sessionID: string; text?: string }[] = [];
  const removed: string[] = [];
  const interrupted: string[] = [];
  let duringReview: ((sessionID: string) => Promise<void> | void) | undefined;

  const context = {
    location: { directory },
    session: {
      create: async (request: Record<string, unknown>) => {
        created.push(request);
        return { id: reviewerSessionID };
      },
      prompt: async (request: { sessionID: string; text?: string }) => {
        prompts.push(request);
        if (duringReview) await duringReview(request.sessionID);
      },
      wait: async () => {
        if (input.wait === "hang") await new Promise(() => undefined);
      },
      context: async () => input.messages ?? [],
      interrupt: async (request: { sessionID: string }) => {
        interrupted.push(request.sessionID);
      },
      remove: async (request: { sessionID: string }) => {
        removed.push(request.sessionID);
        if (input.removeError) throw input.removeError;
      },
      list: input.list ?? (async () => ({ data: [], cursor: { next: null } })),
    },
  } as unknown as Plugin.Context;

  const reviewer = new Reviewer({ context, configuration: input.configuration });

  return {
    reviewer,
    created,
    prompts,
    removed,
    interrupted,
    setDuringReview(callback: (sessionID: string) => Promise<void> | void) {
      duringReview = callback;
    },
  };
}

function assistantText(text: string) {
  return [{ id: "message-1", type: "assistant", content: [{ type: "text", text }] }];
}

function configuration(input: {
  model?: { providerID: string; modelID: string; variant?: string };
  timeoutMs?: number;
}) {
  return parsePluginConfiguration({
    reviewer: {
      ...(input.model === undefined ? {} : { model: input.model }),
      ...(input.timeoutMs === undefined ? {} : { timeoutMs: input.timeoutMs }),
    },
  });
}

describe("Reviewer", () => {
  it("creates an isolated read-only session and returns the parsed verdict", async () => {
    const harness = createHarness({
      configuration: configuration({}),
      messages: assistantText('{"verdict":"allow","reason":"safe read"}') as never,
    });
    let sawReviewerSession = false;
    harness.setDuringReview((sessionID) => {
      sawReviewerSession = harness.reviewer.isReviewerSession(sessionID);
    });

    const verdict = await harness.reviewer.review({
      source: "permission-request",
      sessionID: "origin-session",
      action: "bash",
      resource: { command: "rm -rf build" },
    });

    expect(verdict).toEqual({ verdict: "allow", reason: "safe read" });
    expect(harness.created).toHaveLength(1);
    expect(harness.created[0]).toMatchObject({
      title: "opencode-auto-approve-reviewer",
      location: { directory },
      metadata: { autoApprovalReviewer: true },
      permissions: [
        { action: "*", resource: "*", effect: "deny" },
        { action: "read", resource: "*", effect: "allow" },
        { action: "glob", resource: "*", effect: "allow" },
        { action: "grep", resource: "*", effect: "allow" },
      ],
    });
    expect(harness.prompts[0]?.text).toContain('"action": "bash"');
    expect(harness.prompts[0]?.text).toContain("rm -rf build");
    expect(sawReviewerSession).toBe(true);
    expect(harness.reviewer.isReviewerSession(reviewerSessionID)).toBe(false);
    expect(harness.removed).toEqual([reviewerSessionID]);
  });

  it("prefers the configured reviewer model over the originating model", async () => {
    const harness = createHarness({
      configuration: configuration({
        model: { providerID: "openrouter", modelID: "reviewer-model", variant: "fast" },
      }),
      messages: assistantText('{"verdict":"deny","reason":"unsafe"}') as never,
    });

    await harness.reviewer.review({
      source: "tool-call",
      sessionID: "origin-session",
      action: "write",
      resource: { path: "file.txt" },
      model: { providerID: "anthropic", modelID: "origin-model" },
    });

    expect(harness.created[0]?.model).toEqual({
      providerID: "openrouter",
      id: "reviewer-model",
      variant: "fast",
    });
  });

  it("falls back to the originating message model", async () => {
    const harness = createHarness({
      configuration: configuration({}),
      messages: assistantText('{"verdict":"escalate","reason":"unclear"}') as never,
    });

    await harness.reviewer.review({
      source: "tool-call",
      sessionID: "origin-session",
      action: "edit",
      resource: {},
      model: { providerID: "google", modelID: "gemini", variant: "pro" },
    });

    expect(harness.created[0]?.model).toEqual({
      providerID: "google",
      id: "gemini",
      variant: "pro",
    });
  });

  it("interrupts and removes the session on timeout", async () => {
    const harness = createHarness({
      configuration: configuration({ timeoutMs: 5 }),
      wait: "hang",
    });

    await expect(
      harness.reviewer.review({
        source: "permission-request",
        sessionID: "origin-session",
        action: "bash",
        resource: {},
      }),
    ).rejects.toThrow("Reviewer timed out.");
    expect(harness.interrupted).toEqual([reviewerSessionID]);
    expect(harness.removed).toEqual([reviewerSessionID]);
  });

  it("fails closed when the reviewer returns no JSON", async () => {
    const harness = createHarness({
      configuration: configuration({}),
      messages: assistantText("I think this is fine.") as never,
    });

    await expect(
      harness.reviewer.review({
        source: "permission-request",
        sessionID: "origin-session",
        action: "bash",
        resource: {},
      }),
    ).rejects.toThrow("did not contain JSON");
    expect(harness.interrupted).toEqual([reviewerSessionID]);
    expect(harness.removed).toEqual([reviewerSessionID]);
  });

  it("keeps the verdict when session cleanup fails", async () => {
    const harness = createHarness({
      configuration: configuration({}),
      messages: assistantText('{"verdict":"allow","reason":"safe"}') as never,
      removeError: new Error("cleanup failed"),
    });

    await expect(
      harness.reviewer.review({
        source: "permission-request",
        sessionID: "origin-session",
        action: "read",
        resource: {},
      }),
    ).resolves.toEqual({ verdict: "allow", reason: "safe" });
  });

  it("removes stale reviewer sessions during reconciliation", async () => {
    const harness = createHarness({
      configuration: configuration({}),
      list: async () => ({
        data: [
          {
            id: "stale-reviewer",
            title: "opencode-auto-approve-reviewer",
            metadata: { autoApprovalReviewer: true },
          },
          {
            id: "not-a-reviewer",
            title: "opencode-auto-approve-reviewer",
            metadata: {},
          },
          {
            id: "user-session",
            title: "A normal session",
            metadata: { autoApprovalReviewer: true },
          },
        ],
        cursor: { next: null },
      }),
    });

    await harness.reviewer.reconcile();

    expect(harness.removed).toEqual(["stale-reviewer"]);
  });

  it("survives a failed reconciliation listing", async () => {
    const harness = createHarness({
      configuration: configuration({}),
      list: async () => {
        throw new Error("listing failed");
      },
    });

    await expect(harness.reviewer.reconcile()).resolves.toBeUndefined();
  });
});
