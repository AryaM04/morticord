# Desktop shells: Tauri and Electron

This note explains why the app uses two different desktop tools, and how
to run the media diagnostics check by hand. See ADR 0003 for the formal
decision record.

## Why Tauri on Windows and macOS

Tauri wraps the web app in a small native window. It does not bundle a
browser. Instead, it uses the browser that is already part of the
operating system:

- On Windows, this is WebView2, which is built on Chromium. Chromium has
  full support for `RTCPeerConnection`, `getUserMedia` and
  `getDisplayMedia`, so voice, video and screen share all work.
- On macOS, this is WKWebView, Apple's own browser engine. It supports
  voice and video calls. Screen share needs usage strings and
  entitlements, which this shell already ships (see below).

Because Tauri does not bundle a browser, its installer and its running
memory use are both small. This matters for a friends-scale project that
should stay light on each person's machine.

## Why Electron on Linux

Linux does not have one standard system browser view. The most common
choice, WebKitGTK, has weak and inconsistent WebRTC support across
distributions. Electron bundles its own copy of Chromium, so voice, video
and screen share work the same way on every Linux distribution. The cost
is a larger installer and higher idle memory use, which is an accepted
trade-off only on Linux.

## What the Tauri app does

The Tauri app in `apps/desktop-tauri` loads the web build (`apps/web/dist`)
from its own origin: `http://tauri.localhost` on Windows and
`tauri://localhost` on macOS. In development, it opens the Vite dev server
URL. The web build finds the app through `window.__TAURI_INTERNALS__` and
loads `apps/web/src/desktop/tauri-platform.ts` with a dynamic import, so
the web bundle does not grow.

### Server address

The app has no server of its own. On the first start, it asks for the
server address (for example `chat.example.com`). The app checks the
address with `GET /api/v1/health` and sends its own origin in the
`Origin` header. The server must answer with a CORS header for that
origin. Thus, the server must list the app origins:

```
CORS_ALLOWED_ORIGINS=http://tauri.localhost,tauri://localhost
```

The app keeps the address in the OS key store. Every REST, gateway,
avatar and attachment URL goes through `apps/web/src/lib/server-url.ts`.
In a browser, that helper gives relative URLs (the server is the page
origin). "Change server" in the account settings signs out, forgets the
address and restarts the app.

### Content security policy

`tauri.conf.json` has a strict policy: scripts only from the app, no
remote scripts, `blob:` and `data:` images, and `connect-src` only for the
app and its IPC. At start, the Rust code adds the chosen server to
`connect-src` (with `ws:` or `wss:`) and to `img-src`. Tauri reads the
policy only at start, so a new server address restarts the app.

The window capability (`capabilities/default.json`) allows only the app
commands, event listen and unlisten, and opening http and https links in
the system browser.

### Services of the desktop platform

| Service | How it works |
|---|---|
| Secure store | The OS key store: Windows Credential Manager, macOS Keychain (`keyring` crate). It keeps only small values: the tokens, the pickle key and the server address. The bulk crypto data stays in IndexedDB, encrypted with the pickle key. |
| Notifications | Windows: a toast. A click opens `discordclone://notification/<id>`, and the app opens the channel. macOS: the notification center. A click brings the app to the front, but it does not open the channel. |
| Push to talk | A global shortcut (`tauri-plugin-global-shortcut`). The Pressed and Released states go to the push-to-talk controller of the web app, also while the window has no focus. The voice settings record a key with its modifiers, for example Ctrl + Shift + T. Other apps do not get a registered key, so use a function key or a key with a modifier. |
| Deep links | Scheme `discordclone` (`plugins.deep-link` in `tauri.conf.json`). `discordclone://invite/<code>` opens the invite page. The single-instance plugin gives a link to the running app. |
| OAuth | The app opens the system browser at `/api/v1/auth/oauth/<provider>/start?client=desktop`. The server sends the browser back to `discordclone://auth/callback#code=...` (see `auth.md`). |
| Link previews | The Rust command `link_preview_fetch` fetches the page and the image. It uses the same rules as the server route: only ports 80 and 443, each resolved address is checked (no private, loopback, link-local or unique-local address), each redirect is checked, 3 s, 512 KiB of HTML and a 2 MiB image. The web app reads the page with the same `readHtmlMeta` as the server. |
| Tray | Show, Mute, Deafen and Quit. Mute and Deafen work during a call. By default, the close button keeps the app in the tray. The account settings can turn this off. |
| Window state | `tauri-plugin-window-state` restores the size and the position. |
| Unread badge | Unread direct messages and mentions. macOS: a number on the dock icon. Windows: a red dot on the taskbar button. |
| Updates | See "Updates and signing" below. |

### Screen share

- Windows: WebView2 is Chromium, so `getDisplayMedia` works. The M0 spike
  showed this.
- macOS: WKWebView has no reliable `getDisplayMedia`. The app hides the
  screen share button and shows this reason: "Screen share is not
  available in this app on macOS. Use the web app." A later milestone can
  add a native ScreenCaptureKit plugin (plan section 8).

## Updates and signing

The app asks for
`https://github.com/AryaM04/discord-clone/releases/latest/download/latest.json`
30 s after start and then every 6 hours. When a newer version exists, the
app shows a prompt. It installs the update only after the user clicks
"Install and restart". The updater checks the signature of the download
with the public key in `plugins.updater.pubkey`.

CAUTION: Do not commit the private key. If you lose the private key, the
installed apps cannot get updates. Then you must give the users a new
installer.

To make a new key pair:

1. Run `pnpm --filter desktop-tauri exec tauri signer generate -w <path-outside-the-repo>`.
2. Put the content of the `.pub` file in `plugins.updater.pubkey` in
   `tauri.conf.json`.
3. In the GitHub repository settings, add the secret
   `TAURI_SIGNING_PRIVATE_KEY` with the content of the private key file.
4. If the key has a password, add the secret
   `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.

The updater URL must be public. A private repository gives no release
files without a login, so the check fails there.

## Build and release

- `pnpm --filter desktop-tauri build` makes the MSI and the NSIS installer
  on Windows (in `src-tauri/target/release/bundle`). A local build makes
  no updater files, so it needs no signing key.
- `.github/workflows/release.yml` runs on a tag such as `v0.1.0`. It builds
  on Windows and macOS (one universal app for Apple silicon and Intel),
  signs the updater files when the key secret exists, and makes a draft
  release with the installers and `latest.json`. Without the key, it
  makes a release with installers only, and shows a warning.
- The tag must match `version` in `tauri.conf.json`.
- The macOS app is not signed with an Apple Developer ID. macOS shows a
  warning at the first start. Open the app from Finder with Control-click
  and "Open".

### Small binary settings

The release build uses these Cargo profile settings, in
`apps/desktop-tauri/src-tauri/Cargo.toml`, to keep the installer small:

- `opt-level = "s"`: optimize for size, not speed.
- `lto = true`: remove unused code across the whole build.
- `codegen-units = 1`: let the compiler optimize across the full crate.
- `strip = true`: remove debug symbols from the final binary.
- `panic = "abort"`: drop the unwinding code used for panic recovery.

### macOS notes (not yet tested on a Mac)

Two files prepare the shell for a macOS build:

- `src-tauri/Info.plist` adds `NSCameraUsageDescription` and
  `NSMicrophoneUsageDescription`. macOS shows this text when it asks the
  user for camera or microphone access.
- `src-tauri/entitlements.plist` grants the camera and microphone
  entitlements. Without these, macOS denies the access request before the
  user even sees a prompt.

The app needs macOS 12 or later (`minimumSystemVersion`), for camera and
microphone access in WKWebView. A real macOS build and test must happen
on a Mac before a release.

### Windows permission prompts

WebView2 shows its own permission prompt for `getUserMedia` and
`getDisplayMedia`, the same way the Edge browser does. No extra Rust code
was needed for this on Windows.

## How to run the media diagnostics check by hand

The web app has a small dev-only panel that checks the WebRTC and media
capture APIs. It is not part of the normal app.

1. Start the web app in dev mode: `pnpm --filter web dev`.
2. Open the printed URL with `?diag` added, for example
   `http://localhost:5173/?diag`.
3. A panel appears in the bottom right corner. It shows whether
   `RTCPeerConnection`, `getUserMedia` and `getDisplayMedia` are present.
4. Click "Test microphone", "Test camera" or "Test screen share".
   - The browser or the desktop shell may show its own permission
     prompt. A person must approve this by hand; no script can approve
     it.
   - After approval, the panel shows the track kind, the device label
     and the track settings, then it stops the track.

To run the same check inside the Tauri shell, start the shell in dev mode
(`pnpm --filter desktop-tauri dev`) and add `?diag` to the window URL
through the same dev server, since the shell loads that URL directly.
