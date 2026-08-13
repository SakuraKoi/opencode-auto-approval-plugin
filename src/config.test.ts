import { describe, expect, it } from "vitest";

import { parsePluginConfiguration } from "./config.js";

describe("parsePluginConfiguration", () => {
  it("uses the safe on-ask defaults", () => {
    expect(parsePluginConfiguration({})).toEqual({
      mode: "on-ask",
      reviewer: { timeoutMs: 30_000 },
    });
  });

  it("accepts an independent reviewer model", () => {
    expect(
      parsePluginConfiguration({
        mode: "all-tools",
        reviewer: {
          model: { providerID: "openrouter", modelID: "openai/gpt-5.6-luna" },
          timeoutMs: 12_000,
        },
      }),
    ).toEqual({
      mode: "all-tools",
      reviewer: {
        model: { providerID: "openrouter", modelID: "openai/gpt-5.6-luna" },
        timeoutMs: 12_000,
      },
    });
  });

  it("rejects an unknown mode", () => {
    expect(() => parsePluginConfiguration({ mode: "all" })).toThrow(
      "Invalid auto-approval plugin options",
    );
  });
});
