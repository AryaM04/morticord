// Skeleton of the main 4-column layout: server rail, channel list, chat
// pane and member list. There is no routing yet. Later milestones will
// add real data and navigation.

import { Suspense, lazy } from "react";

// Load the diagnostics panel only when a person opens the page with
// "?diag" in a dev build. The lazy import keeps it out of the normal
// app bundle, per the resource rules in CLAUDE.md.
const DiagPanel = lazy(() => import("./diag/DiagPanel.js"));

function shouldShowDiagPanel(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }
  return new URLSearchParams(window.location.search).has("diag");
}

function ServerRail() {
  return (
    <div
      className="flex w-[72px] flex-col items-center gap-2 py-3"
      style={{ backgroundColor: "var(--color-bg-rail)" }}
    >
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full"
        style={{ backgroundColor: "var(--color-accent)" }}
      >
        DC
      </div>
    </div>
  );
}

function ChannelList() {
  return (
    <div
      className="flex w-60 flex-col p-3"
      style={{ backgroundColor: "var(--color-bg-sidebar)" }}
    >
      <div className="mb-2 font-semibold">Guild name</div>
      <div style={{ color: "var(--color-text-muted)" }}># general</div>
    </div>
  );
}

function ChatPane() {
  return (
    <div className="flex flex-1 flex-col p-3" style={{ backgroundColor: "var(--color-bg-main)" }}>
      <div className="mb-2 font-semibold"># general</div>
      <div className="flex-1" style={{ color: "var(--color-text-muted)" }}>
        No messages yet.
      </div>
    </div>
  );
}

function MemberList() {
  return (
    <div
      className="flex w-60 flex-col p-3"
      style={{ backgroundColor: "var(--color-bg-members)" }}
    >
      <div style={{ color: "var(--color-text-muted)" }}>Members</div>
    </div>
  );
}

export function App() {
  return (
    <div className="flex h-full w-full">
      <ServerRail />
      <ChannelList />
      <ChatPane />
      <MemberList />
      {shouldShowDiagPanel() && (
        <Suspense fallback={null}>
          <DiagPanel />
        </Suspense>
      )}
    </div>
  );
}
