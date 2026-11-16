import { describe, expect, it } from "vitest";

import { disableReasoning, sessionModel } from "./reviewer-agent.ts";

describe("disableReasoning", () => {
  it("uses the Anthropic thinking option", () => {
    const options: Record<string, unknown> = {};
    disableReasoning({ providerID: "anthropic", options });
    expect(options).toEqual({ thinking: { type: "disabled" } });
  });

  it("uses the Alibaba thinking option", () => {
    const options: Record<string, unknown> = {};
    disableReasoning({ providerID: "alibaba", options });
    expect(options).toEqual({ thinking: { type: "disabled" } });
  });

  it("uses the Google thinking config", () => {
    const options: Record<string, unknown> = {};
    disableReasoning({ providerID: "google", options });
    expect(options).toEqual({ thinkingConfig: { includeThoughts: false, thinkingBudget: 0 } });
  });

  it("falls back to reasoningEffort for other providers", () => {
    const options: Record<string, unknown> = {};
    disableReasoning({ providerID: "openrouter", options });
    expect(options).toEqual({ reasoningEffort: "none" });
  });
});

describe("sessionModel", () => {
  it("adapts the configured model reference", () => {
    expect(sessionModel({ providerID: "openrouter", modelID: "model", variant: "fast" })).toEqual({
      providerID: "openrouter",
      id: "model",
      variant: "fast",
    });
  });

  it("omits an absent variant", () => {
    expect(sessionModel({ providerID: "openrouter", modelID: "model" })).toEqual({
      providerID: "openrouter",
      id: "model",
    });
  });
});
