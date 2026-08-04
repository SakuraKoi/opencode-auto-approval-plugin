import { describe, expect, it } from "vitest";

import { greet } from "./index.js";

describe("greet", () => {
  it("greets with the default greeting", () => {
    expect(greet({ name: "world" })).toBe("Hello, world!");
  });

  it("greets with a custom greeting", () => {
    expect(greet({ name: "world", greeting: "Hi" })).toBe("Hi, world!");
  });
});
