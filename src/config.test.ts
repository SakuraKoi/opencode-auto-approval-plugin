import { describe, expect, it } from "vitest";

import { parsePluginConfiguration } from "./config.ts";

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

  it("accepts an optional model variant", () => {
    expect(
      parsePluginConfiguration({
        reviewer: {
          model: { providerID: "openrouter", modelID: "openai/gpt-5.6-luna", variant: "fast" },
        },
      }).reviewer.model,
    ).toEqual({ providerID: "openrouter", modelID: "openai/gpt-5.6-luna", variant: "fast" });
  });

  it("rejects an unknown mode", () => {
    expect(() => parsePluginConfiguration({ mode: "all" })).toThrow(
      "Invalid auto-approval plugin options",
    );
  });

  it("rejects a timeout outside the supported range", () => {
    expect(() => parsePluginConfiguration({ reviewer: { timeoutMs: 0 } })).toThrow(
      "Invalid auto-approval plugin options",
    );
  });
});
