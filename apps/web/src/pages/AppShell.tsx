// The main 4-column layout: server rail, channel list, chat pane and
// member list.
import { Suspense, lazy, useEffect } from "react";
import { Redirect, useParams } from "wouter";
import { ServerRail } from "../components/ServerRail.js";
import { ChannelColumn } from "../components/ChannelColumn.js";
import { ChatPane } from "../components/ChatPane.js";
import { MemberList } from "../components/MemberList.js";
import { UserPanel } from "../components/UserPanel.js";
import { VerifyBanner } from "../components/VerifyBanner.js";
import { HomePage } from "./HomePage.js";
import { useRealtime } from "../lib/useRealtime.js";
import { readLastLocation, rememberLastLocation } from "../lib/lastLocation.js";

// Load the diagnostics panel only when a person opens the page with
// "?diag" in a dev build. The lazy import keeps it out of the normal
// app bundle, per the resource rules in CLAUDE.md.
const DiagPanel = lazy(() => import("../diag/DiagPanel.js"));

function shouldShowDiagPanel(): boolean {
  if (!import.meta.env.DEV) {
    return false;
  }
  return new URLSearchParams(window.location.search).has("diag");
}

function AppHome() {
  const lastLocation = readLastLocation();
  if (lastLocation) {
    return <Redirect to={`/app/${lastLocation.guildId}/${lastLocation.channelId}`} />;
  }
  return (
    <>
      <div className="flex w-60 flex-col" style={{ backgroundColor: "var(--color-bg-sidebar)" }}>
        <div className="flex-1" />
        <UserPanel />
      </div>
      <HomePage />
    </>
  );
}

function GuildView({ guildId, channelId }: { guildId: string; channelId: string | null }) {
  const guildLoaded = useRealtime((s) => Boolean(s.guilds[guildId]));

  useEffect(() => {
    if (guildLoaded && channelId) {
      rememberLastLocation(guildId, channelId);
    }
  }, [guildLoaded, guildId, channelId]);

  return (
    <>
      <ChannelColumn guildId={guildId} activeChannelId={channelId} />
      <ChatPane channelId={channelId} />
      <MemberList guildId={guildId} />
    </>
  );
}

export function AppShell() {
  const params = useParams<{ guildId?: string; channelId?: string }>();

  return (
    <div className="flex h-full w-full flex-col">
      <VerifyBanner />
      <div className="flex flex-1">
        <ServerRail activeGuildId={params.guildId} />
        {params.guildId ? <GuildView guildId={params.guildId} channelId={params.channelId ?? null} /> : <AppHome />}
        {shouldShowDiagPanel() && (
          <Suspense fallback={null}>
            <DiagPanel />
          </Suspense>
        )}
      </div>
    </div>
  );
}
