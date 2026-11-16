import { describe, expect, it } from "vitest";

import { autoApprovalMode } from "./mode.ts";

describe("autoApprovalMode", () => {
  it("is off when neither mode is enabled", () => {
    expect(autoApprovalMode({ autoReview: false, yolo: false })).toBe("off");
  });

  it("reports the auto-approval reviewer", () => {
    expect(autoApprovalMode({ autoReview: true, yolo: false })).toBe("review");
  });

  it("reports yolo", () => {
    expect(autoApprovalMode({ autoReview: false, yolo: true })).toBe("yolo");
  });

  it("prefers yolo when both modes are enabled", () => {
    expect(autoApprovalMode({ autoReview: true, yolo: true })).toBe("yolo");
  });
});
