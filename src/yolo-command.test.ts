import { describe, expect, it, vi } from "vitest";

import { createYoloCommandHandler } from "./yolo-command.ts";

const sessionID = "session-1";

function createHandler() {
  const notify = vi.fn(async () => undefined);
  return { handler: createYoloCommandHandler({ notify }), notify };
}

async function execute(input: {
  handler: ReturnType<typeof createYoloCommandHandler>;
  args: string;
}) {
  await input.handler.execute({ arguments: input.args, sessionID });
}

describe("createYoloCommandHandler", () => {
  it("starts disabled", () => {
    const { handler } = createHandler();
    expect(handler.isEnabled()).toBe(false);
  });

  it("enables and disables with explicit arguments", async () => {
    const { handler, notify } = createHandler();

    await execute({ handler, args: "true" });
    expect(handler.isEnabled()).toBe(true);
    expect(notify).toHaveBeenLastCalledWith({
      sessionID,
      message: "Yolo mode enabled.",
      variant: "success",
    });

    await execute({ handler, args: "false" });
    expect(handler.isEnabled()).toBe(false);
    expect(notify).toHaveBeenLastCalledWith({
      sessionID,
      message: "Yolo mode disabled.",
      variant: "success",
    });
  });

  it("toggles for an unrecognized argument", async () => {
    const { handler } = createHandler();

    await execute({ handler, args: "yes" });
    expect(handler.isEnabled()).toBe(true);

    await execute({ handler, args: "yes" });
    expect(handler.isEnabled()).toBe(false);
  });

  it("supports silent disable for mutual exclusivity", async () => {
    const { handler } = createHandler();

    await execute({ handler, args: "true" });
    expect(handler.isEnabled()).toBe(true);
    handler.disable();
    expect(handler.isEnabled()).toBe(false);
  });
});
