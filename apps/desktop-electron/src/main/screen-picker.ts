// Screen share for the Linux app. A call to getDisplayMedia in the app
// window comes to the display media handler. The handler gets the screens
// and windows from desktopCapturer and shows a small picker window with a
// thumbnail of each. On Wayland, the system (PipeWire portal) shows its own
// picker inside getSources and gives one source, so the app uses it at
// once.
//
// System audio: Electron gives "loopback" audio only on Windows. On Linux
// the shared screen has no system audio. See docs/concepts/desktop-shells.md.
import { BrowserWindow, desktopCapturer, ipcMain, type DesktopCapturerSource, type Session } from "electron";
import { PICKER_CHOOSE, PICKER_SOURCES, type PickerSource } from "../shared/channels.js";

interface OpenPicker {
  window: BrowserWindow;
  sources: PickerSource[];
  finish(id: string | null): void;
}

let open: OpenPicker | null = null;

function pick(
  parent: BrowserWindow | null,
  sources: DesktopCapturerSource[],
  preload: string,
  pageUrl: string,
): Promise<DesktopCapturerSource | null> {
  return new Promise((resolve) => {
    const window = new BrowserWindow({
      parent: parent ?? undefined,
      modal: parent !== null,
      width: 760,
      height: 540,
      minWidth: 400,
      minHeight: 300,
      title: "Share your screen",
      autoHideMenuBar: true,
      show: false,
      backgroundColor: "#313338",
      webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    let finished = false;
    const picker: OpenPicker = {
      window,
      sources: sources.map((source) => ({
        id: source.id,
        name: source.name,
        thumbnail: source.thumbnail.isEmpty() ? "" : source.thumbnail.toDataURL(),
      })),
      finish(id) {
        if (finished) {
          return;
        }
        finished = true;
        open = null;
        resolve(sources.find((source) => source.id === id) ?? null);
        if (!window.isDestroyed()) {
          window.close();
        }
      },
    };
    open = picker;
    window.on("closed", () => picker.finish(null));
    window.once("ready-to-show", () => window.show());
    void window.loadURL(pageUrl);
  });
}

export interface ScreenShareOptions {
  session: Session;
  /** The app window, the parent of the picker. */
  parent(): BrowserWindow | null;
  /** True for a frame of the app origin. */
  isAppUrl(url: string): boolean;
  /** The preload script of the picker window. */
  preload: string;
  /** The URL of the picker page. */
  pageUrl: string;
}

export function setUpScreenShare(options: ScreenShareOptions): void {
  ipcMain.handle(PICKER_SOURCES, (event) => (open && event.sender === open.window.webContents ? open.sources : []));
  ipcMain.on(PICKER_CHOOSE, (event, id: unknown) => {
    if (open && event.sender === open.window.webContents) {
      open.finish(typeof id === "string" ? id : null);
    }
  });

  options.session.setDisplayMediaRequestHandler((request, callback) => {
    const choose = async () => {
      // One picker at a time, and only for the app page.
      if (open || !request.frame || !options.isAppUrl(request.frame.url)) {
        return null;
      }
      const sources = await desktopCapturer.getSources({
        types: ["screen", "window"],
        thumbnailSize: { width: 320, height: 180 },
      });
      if (sources.length <= 1) {
        return sources[0] ?? null;
      }
      return pick(options.parent(), sources, options.preload, options.pageUrl);
    };
    choose().then(
      (source) => {
        if (!source) {
          // An empty answer refuses the request: getDisplayMedia rejects with NotAllowedError.
          callback({});
          return;
        }
        callback(
          request.audioRequested && process.platform === "win32" ? { video: source, audio: "loopback" } : { video: source },
        );
      },
      () => callback({}),
    );
  });
}
