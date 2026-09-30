// Tests for the small parts of the main process: deep links, the window
// state, the update rule and the link preview result.
import { describe, expect, it, vi } from "vitest";
import { LinkPreviewError } from "@discord-clone/link-preview-fetch";
import { deepLinksIn, PendingLinks } from "./deep-links.js";
import { createLinkPreview } from "./link-preview.js";
import { canUpdateItself } from "./updates.js";
import { restorableState } from "./window-state.js";

describe("deep links", () => {
  it("finds the links of the app scheme in the arguments", () => {
    const argv = ["/opt/Discord Clone/discord-clone", "--no-sandbox", "discordclone://invite/abc", "https://x.test"];
    expect(deepLinksIn(argv, "discordclone")).toEqual(["discordclone://invite/abc"]);
    expect(deepLinksIn([`discordclone://${"a".repeat(3000)}`], "discordclone")).toEqual([]);
  });

  it("keeps links until the page takes them, then sends them at once, and holds again on a reload", () => {
    const send = vi.fn();
    const pending = new PendingLinks(send);
    pending.add(["discordclone://invite/a"]);
    expect(send).not.toHaveBeenCalled();
    expect(pending.take()).toEqual(["discordclone://invite/a"]);
    pending.add(["discordclone://invite/b"]);
    expect(send).toHaveBeenCalledWith(["discordclone://invite/b"]);
    pending.hold();
    pending.add(["discordclone://invite/c"]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(pending.take()).toEqual(["discordclone://invite/c"]);
    expect(pending.take()).toEqual([]);
  });
});

describe("restorableState", () => {
  const screens = [{ x: 0, y: 0, width: 1920, height: 1080 }];

  it("uses a kept state that is on a screen", () => {
    const stored = { bounds: { x: 100, y: 50, width: 1200, height: 800 }, maximized: true };
    expect(restorableState(stored, screens)).toEqual(stored);
  });

  it("does not use a state that is off the screens, too small or not valid", () => {
    expect(restorableState({ bounds: { x: 3000, y: 0, width: 1200, height: 800 } }, screens)).toBeNull();
    expect(restorableState({ bounds: { x: 1500, y: 0, width: 1200, height: 800 } }, screens)).toBeNull();
    expect(restorableState({ bounds: { x: 0, y: 0, width: 100, height: 100 } }, screens)).toBeNull();
    expect(restorableState({ bounds: { x: "0", y: 0, width: 1200, height: 800 } }, screens)).toBeNull();
    expect(restorableState(null, screens)).toBeNull();
  });
});

describe("canUpdateItself", () => {
  it("is true only for a packaged AppImage", () => {
    expect(canUpdateItself(true, { APPIMAGE: "/home/u/discord-clone.AppImage" })).toBe(true);
    expect(canUpdateItself(true, {})).toBe(false);
    expect(canUpdateItself(false, { APPIMAGE: "/x.AppImage" })).toBe(false);
  });
});

describe("createLinkPreview", () => {
  it("gives the preview with the image as plain bytes", async () => {
    const fetchLinkPreview = createLinkPreview(async (url) => ({
      url,
      title: "Title",
      image: { mime: "image/png", bytes: Buffer.from([1, 2, 3]) },
    }));
    const preview = await fetchLinkPreview("https://example.com/");
    expect(preview).toEqual({
      url: "https://example.com/",
      title: "Title",
      description: undefined,
      siteName: undefined,
      image: { mime: "image/png", bytes: new Uint8Array([1, 2, 3]) },
    });
    expect(Buffer.isBuffer(preview!.image!.bytes)).toBe(false);
  });

  it("gives null for a link that is not allowed or has no preview", async () => {
    const refused = createLinkPreview(async () => {
      throw new LinkPreviewError("URL_NOT_ALLOWED", "This link goes to a private network address.");
    });
    expect(await refused("http://10.0.0.1/")).toBeNull();
  });
});
