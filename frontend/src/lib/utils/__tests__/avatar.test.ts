import {
  getFallbackAvatar,
  getProxiedAvatarUrl,
  handleAvatarError,
} from "../avatar";

describe("avatar utils", () => {
  it("returns a fallback avatar when the original url is missing", () => {
    expect(getProxiedAvatarUrl("")).toBe(getFallbackAvatar("User"));
  });

  it("passes through ui-avatars urls", () => {
    const url = "https://ui-avatars.com/api/?name=Demo";

    expect(getProxiedAvatarUrl(url)).toBe(url);
  });

  it("proxies Twitch CDN avatar urls", () => {
    const url = "https://static-cdn.jtvnw.net/jtv_user_pictures/demo-profile.png";

    expect(getProxiedAvatarUrl(url)).toBe(
      `http://localhost:4000/api/proxy/avatar?url=${encodeURIComponent(url)}`
    );
  });

  it("proxies Twitch assets urls", () => {
    const url = "https://assets.twitch.tv/profile-image.png";

    expect(getProxiedAvatarUrl(url)).toBe(
      `http://localhost:4000/api/proxy/avatar?url=${encodeURIComponent(url)}`
    );
  });

  it("returns non-Twitch urls unchanged", () => {
    const url = "https://example.com/avatar.png";

    expect(getProxiedAvatarUrl(url)).toBe(url);
  });

  it("builds encoded fallback avatar urls with custom size", () => {
    expect(getFallbackAvatar("Jane Doe", 64)).toBe(
      "https://ui-avatars.com/api/?name=Jane%20Doe&background=random&size=64"
    );
  });

  it("replaces broken image sources with a fallback avatar", () => {
    const currentTarget = {
      src: "https://broken.example/avatar.png",
      onerror: jest.fn(),
    } as unknown as HTMLImageElement;

    handleAvatarError(
      { currentTarget } as React.SyntheticEvent<HTMLImageElement, Event>,
      "Fallback User"
    );

    expect(currentTarget.src).toBe(getFallbackAvatar("Fallback User"));
    expect(currentTarget.onerror).toBeNull();
  });
});
