import { fireEvent, render, screen } from "@testing-library/react";

import { ViewerChannelCard } from "../ViewerChannelCard";

jest.mock("next/image", () => ({
  __esModule: true,
  // eslint-disable-next-line @next/next/no-img-element
  default: (props: React.ImgHTMLAttributes<HTMLImageElement>) => <img {...props} alt={props.alt || ""} />,
}));

describe("ViewerChannelCard", () => {
  const onOpen = jest.fn();
  const t = (key: string) => key;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("opens the channel on card click and does not bubble watch-now link clicks", () => {
    const { container } = render(
      <ViewerChannelCard
        channel={{
          id: "channel-1",
          channelName: "demochannel",
          displayName: "Demo Channel",
          avatarUrl: "",
          category: "Action",
          isLive: true,
          viewerCount: 12,
          streamStartedAt: "2026-03-16T01:00:00.000Z",
          followedAt: "2026-03-01T00:00:00.000Z",
          tags: [],
          lastWatched: "2026-03-15T00:00:00.000Z",
          totalWatchMinutes: 120,
          messageCount: 8,
        }}
        t={t}
        onOpen={onOpen}
      />
    );

    fireEvent.click(container.querySelector('[role="button"]') as HTMLElement);
    expect(onOpen).toHaveBeenCalledWith("channel-1");

    onOpen.mockClear();
    fireEvent.click(screen.getByRole("link", { name: "viewer.watchNow" }));
    expect(onOpen).not.toHaveBeenCalled();
  });

  it("ignores non-activation keys", () => {
    const { container } = render(
      <ViewerChannelCard
        channel={{
          id: "channel-2",
          channelName: "quietchannel",
          displayName: "Quiet Channel",
          avatarUrl: "",
          category: "",
          isLive: false,
          viewerCount: 0,
          streamStartedAt: null,
          followedAt: null,
          tags: [],
          lastWatched: null,
          totalWatchMinutes: 0,
          messageCount: 0,
        }}
        t={t}
        onOpen={onOpen}
      />
    );

    fireEvent.keyDown(container.querySelector('[role="button"]') as HTMLElement, { key: "Escape" });

    expect(onOpen).not.toHaveBeenCalled();
  });
});
