// The main 4-column layout: server rail, channel list, chat pane and
// member list. `/app/@me` is Home: the friends and the DMs.
import { Suspense, lazy, useEffect, useRef } from "react";
import { Redirect, useParams, useLocation } from "wouter";
import { ServerRail } from "../components/ServerRail.js";
import { ChannelColumn } from "../components/ChannelColumn.js";
import { ChatPane } from "../components/ChatPane.js";
import { MemberList } from "../components/MemberList.js";
import { VerifyBanner } from "../components/VerifyBanner.js";
import { NoticeBanner } from "../components/NoticeBanner.js";
import { SecurityBanner } from "../components/SecurityBanner.js";
import { CryptoTabBanner } from "../components/ConnectionBanner.js";
import { HomeView } from "./HomeView.js";
import { useRealtime } from "../lib/useRealtime.js";
import { clearLastLocation, readLastLocation, rememberLastLocation } from "../lib/lastLocation.js";
import { showNotice } from "../lib/notice.js";

// Load the diagnostics panel only when a person opens the page with
// "?diag" in a dev build. The lazy import keeps it out of the normal
// app bundle, per the resource rules in CLAUDE.md.
const DiagPanel = lazy(() => import("../diag/DiagPanel.js"));

// A stable fallback: a fresh `[]` on every render would break the store
// subscription (it always looks "changed"), causing a render loop.
const EMPTY_CHANNEL_IDS: string[] = [];

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
  return <HomeView channelId={null} />;
}

function GuildView({ guildId, channelId }: { guildId: string; channelId: string | null }) {
  const guildLoaded = useRealtime((s) => Boolean(s.guilds[guildId]));
  const channelIds = useRealtime((s) => s.channelIdsByGuild[guildId] ?? EMPTY_CHANNEL_IDS);
  const [, navigate] = useLocation();
  const wasLoadedRef = useRef(false);

  useEffect(() => {
    if (guildLoaded && channelId) {
      rememberLastLocation(guildId, channelId);
    }
  }, [guildLoaded, guildId, channelId]);

  // GUILD_DELETE (left, kicked or banned) removes the guild from the
  // store. Once that happens for a guild that was loaded a moment ago,
  // leave its page instead of rendering a shell with no data.
  useEffect(() => {
    if (guildLoaded) {
      wasLoadedRef.current = true;
      return;
    }
    if (wasLoadedRef.current) {
      wasLoadedRef.current = false;
      // Forget this guild as "the last place you were": otherwise /app
      // would read it right back and redirect straight into the guild
      // this effect is trying to leave.
      clearLastLocation();
      showNotice("You are no longer a member of this server.");
      navigate("/app");
    }
  }, [guildLoaded, navigate]);

  // Losing VIEW_CHANNEL on the open channel removes it from the guild's
  // channel list (a CHANNEL_DELETE dispatch, per docs/concepts/permissions.md).
  // Move to the first channel still visible, with a notice.
  useEffect(() => {
    if (!guildLoaded || !channelId) {
      return;
    }
    if (channelIds.includes(channelId)) {
      return;
    }
    showNotice("You can no longer see that channel.");
    const next = channelIds[0];
    navigate(next ? `/app/${guildId}/${next}` : `/app/${guildId}`);
  }, [guildLoaded, channelId, channelIds, guildId, navigate]);

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
      <SecurityBanner />
      <NoticeBanner />
      <CryptoTabBanner />
      <div className="flex flex-1">
        <ServerRail activeGuildId={params.guildId} />
        {params.guildId === "@me" ? (
          <HomeView channelId={params.channelId ?? null} />
        ) : params.guildId ? (
          <GuildView guildId={params.guildId} channelId={params.channelId ?? null} />
        ) : (
          <AppHome />
        )}
        {shouldShowDiagPanel() && (
          <Suspense fallback={null}>
            <DiagPanel />
          </Suspense>
        )}
      </div>
    </div>
  );
}
