# ADR 0003: Tauri for Windows and macOS, Electron for Linux

## Status

Accepted.

## Context

The app needs desktop shells for push-to-talk hotkeys, tray icons, deep
links and native notifications. Tauri gives small binaries, but its Linux
WebView (WebKitGTK) has weak and inconsistent WebRTC support.

## Decision

Windows and macOS use Tauri v2, with the OS-native WebView (WebView2 on
Windows, WKWebView on macOS). Linux uses Electron, which bundles Chromium
and so gives reliable WebRTC on Linux.

## Consequences

- Two desktop build pipelines exist, one for Tauri and one for Electron.
  Both load the same web app build, so most code is shared.
- macOS screen share through WKWebView is a known risk. Milestone M0
  includes a spike to check `getDisplayMedia` support before real work
  starts on that platform.
- CI must build and test both shells on tag, which adds pipeline steps in
  milestone M7.
