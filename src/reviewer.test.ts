import { describe, expect, it } from "vitest";

import { parsePluginConfiguration } from "./config.js";
import {
  Reviewer,
  reviewerAgent,
  reviewerAgentName,
  type ReviewSessionClient,
} from "./reviewer.js";

function clientWithResponse(input: {
  response: string;
}): ReviewSessionClient & { prompts: unknown[] } {
  const prompts: unknown[] = [];
  return {
    prompts,
    session: {
      create: async () => ({ id: "review-session" }),
      prompt: async (request) => {
        prompts.push(request);
        return { parts: [{ type: "text", text: input.response }] };
      },
    },
  };
}

describe("Reviewer", () => {
  it("inherits the main session model when no reviewer model is configured", async () => {
    const client = clientWithResponse({ response: '{"verdict":"allow","reason":"read-only"}' });
    const reviewer = new Reviewer({
      client,
      directory: "/workspace",
      configuration: parsePluginConfiguration({}),
    });

    await expect(
      reviewer.review({
        source: "tool-call",
        sessionID: "main-session",
        action: "read",
        resource: { filePath: "README.md" },
        model: { providerID: "openai", modelID: "gpt-5.6-luna" },
      }),
    ).resolves.toEqual({ verdict: "allow", reason: "read-only" });

    expect(client.prompts).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({
          agent: reviewerAgentName,
          model: { providerID: "openai", modelID: "gpt-5.6-luna" },
          tools: { read: true, glob: true, grep: true, lsp: true },
        }),
      }),
    ]);
  });

  it("uses a configured reviewer model in preference to the main session model", async () => {
    const client = clientWithResponse({ response: '{"verdict":"deny","reason":"destructive"}' });
    const reviewer = new Reviewer({
      client,
      directory: "/workspace",
      configuration: parsePluginConfiguration({
        reviewer: { model: { providerID: "openrouter", modelID: "openai/gpt-5.6-luna" } },
      }),
    });

    await reviewer.review({
      source: "tool-call",
      sessionID: "main-session",
      action: "bash",
      resource: { command: "rm -rf build" },
      model: { providerID: "openai", modelID: "gpt-5.6" },
    });

    expect(client.prompts).toEqual([
      expect.objectContaining({
        body: expect.objectContaining({
          model: { providerID: "openrouter", modelID: "openai/gpt-5.6-luna" },
        }),
      }),
    ]);
  });

  it("registers an agent that only exposes read-only tools", () => {
    expect(reviewerAgent()).toMatchObject({
      mode: "subagent",
      tools: { read: true, glob: true, grep: true, lsp: true },
      permission: { "*": "deny", read: "allow", edit: "deny", bash: "deny" },
    });
  });
});
