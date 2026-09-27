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

## What this shell does today

The Tauri shell in `apps/desktop-tauri` only loads the web app in a
window:

- In development, it opens the Vite dev server URL.
- In a release build, it loads the built files from `apps/web/dist`.

It has no plugins yet. Push-to-talk hotkeys, a tray icon, deep links and
an updater come in a later milestone (see plan section 8).

### Small binary settings

The release build uses these Cargo profile settings, in
`apps/desktop-tauri/src-tauri/Cargo.toml`, to keep the installer small:

- `opt-level = "s"`: optimize for size, not speed.
- `lto = true`: remove unused code across the whole build.
- `codegen-units = 1`: let the compiler optimize across the full crate.
- `strip = true`: remove debug symbols from the final binary.
- `panic = "abort"`: drop the unwinding code used for panic recovery.

### macOS notes (not yet tested on this machine)

Two files prepare the shell for a macOS build:

- `src-tauri/Info.plist` adds `NSCameraUsageDescription` and
  `NSMicrophoneUsageDescription`. macOS shows this text when it asks the
  user for camera or microphone access.
- `src-tauri/entitlements.plist` grants the camera and microphone
  entitlements. Without these, macOS denies the access request before the
  user even sees a prompt.

Screen share through WKWebView is the biggest open risk on macOS (see
plan section 8 and section 12). A real macOS build and test must happen
on a Mac before we trust this path.

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
