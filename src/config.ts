import * as z from "zod/mini";

const reviewerModes = ["on-ask", "all-tools"] as const;

type ReviewerMode = (typeof reviewerModes)[number];

export type ModelReference = {
  providerID: string;
  modelID: string;
};

export type PluginConfiguration = {
  mode: ReviewerMode;
  reviewer: {
    model?: ModelReference;
    timeoutMs: number;
  };
};

const modelReferenceSchema = z.object({
  providerID: z.string(),
  modelID: z.string(),
});

const pluginConfigurationSchema = z.object({
  mode: z.optional(z.enum(reviewerModes)),
  reviewer: z.optional(
    z.object({
      model: z.optional(modelReferenceSchema),
      timeoutMs: z.optional(z.number().check(z.gte(1), z.lte(120_000))),
    }),
  ),
});

export function parsePluginConfiguration(input: unknown): PluginConfiguration {
  const result = z.safeParse(pluginConfigurationSchema, input);
  if (!result.success) {
    throw new Error(`Invalid auto-approval plugin options: ${result.error.message}`);
  }

  return {
    mode: result.data.mode ?? "on-ask",
    reviewer: {
      model: result.data.reviewer?.model,
      timeoutMs: result.data.reviewer?.timeoutMs ?? 30_000,
    },
  };
}
