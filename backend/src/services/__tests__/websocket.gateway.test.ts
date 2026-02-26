jest.mock("../../utils/logger", () => ({
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  },
}));

import { WebSocketGateway } from "../websocket.gateway";

describe("WebSocketGateway emitViewerStatsBatch", () => {
  it("emits batch updates to viewer room", () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const gateway = new WebSocketGateway();

    (gateway as any).io = { to };

    gateway.emitViewerStatsBatch("viewer-1", [
      { channelId: "c1", messageCountDelta: 2 },
      { channelId: "c2", messageCountDelta: 1 },
    ]);

    expect(to).toHaveBeenCalledWith("viewer:viewer-1");
    expect(emit).toHaveBeenCalledWith("stats-update-batch", {
      updates: [
        { channelId: "c1", messageCountDelta: 2 },
        { channelId: "c2", messageCountDelta: 1 },
      ],
    });
  });

  it("does nothing for empty batch", () => {
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const gateway = new WebSocketGateway();

    (gateway as any).io = { to };

    gateway.emitViewerStatsBatch("viewer-1", []);

    expect(to).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });
});
