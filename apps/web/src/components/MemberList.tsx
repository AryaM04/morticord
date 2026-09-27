// The right-hand member list: keyset-paginated over REST, kept live by
// gateway events, grouped into Online and Offline with counts.
import { useCallback, useEffect, useRef, useState } from "react";
import { useStore } from "zustand";
import { listGuildMembers } from "@discord-clone/client-core";
import type { GuildMemberJson } from "@discord-clone/shared";
import { session } from "../lib/session.js";
import { realtimeStore } from "../lib/realtime.js";
import { useRealtime } from "../lib/useRealtime.js";
import { presenceUiStore } from "../lib/presence.js";

const PAGE_SIZE = 50;

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

const PRESENCE_LABEL: Record<string, string> = {
  online: "Online",
  idle: "Idle",
  dnd: "Do not disturb",
  offline: "Offline",
};

const PRESENCE_COLOR: Record<string, string> = {
  online: "#3ba55d",
  idle: "#faa61a",
  dnd: "#ed4245",
  offline: "#747f8d",
};

function MemberRow({ member, status }: { member: GuildMemberJson; status: string }) {
  const name = member.nickname ?? member.user?.displayName ?? member.userId;
  return (
    <li className="flex items-center gap-2 px-2 py-1">
      <div className="relative">
        {member.user?.avatarKey ? (
          <img
            src={`/api/v1/avatars/${member.userId}/${member.user.avatarKey}`}
            alt=""
            className="h-8 w-8 rounded-full object-cover"
          />
        ) : (
          <div
            className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
            style={{ backgroundColor: "var(--color-accent)", color: "white" }}
            aria-hidden="true"
          >
            {initialsOf(member.user?.displayName ?? name)}
          </div>
        )}
        <span
          aria-hidden="true"
          className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2"
          style={{ backgroundColor: PRESENCE_COLOR[status] ?? PRESENCE_COLOR.offline, borderColor: "var(--color-bg-members)" }}
        />
      </div>
      <span className="truncate text-sm">{name}</span>
      <span className="sr-only">{PRESENCE_LABEL[status] ?? "Offline"}</span>
    </li>
  );
}

const EMPTY_MEMBERS: Record<string, GuildMemberJson> = {};

export function MemberList({ guildId }: { guildId: string }) {
  // A stable fallback object: a fresh `{}` on every render would break
  // the store subscription (it always looks "changed"), causing a
  // render loop, so a module-level constant is used instead.
  const members = useRealtime((s) => s.membersByGuild[guildId] ?? EMPTY_MEMBERS);
  const presences = useRealtime((s) => s.presences);
  const selfUserId = useRealtime((s) => s.selfUserId);
  // The server never tells a user their own presence (there is no "you"
  // to broadcast to), so the signed-in user's own row uses the status
  // they chose instead of the shared presence map.
  const chosenStatus = useStore(presenceUiStore, (s) => s.chosenStatus);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [done, setDone] = useState(false);
  const loadingRef = useRef(false);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loadingRef.current || done) return;
    loadingRef.current = true;
    try {
      const page = await listGuildMembers(session.apiClient, guildId, { after: cursor, limit: PAGE_SIZE });
      realtimeStore.getState().addMemberPage(guildId, page.members);
      if (page.members.length < PAGE_SIZE) {
        setDone(true);
      }
      const last = page.members[page.members.length - 1];
      if (last) {
        setCursor(last.userId);
      }
    } finally {
      loadingRef.current = false;
    }
  }, [guildId, cursor, done]);

  // Reset paging state and load the first page whenever the guild changes.
  useEffect(() => {
    setCursor(undefined);
    setDone(false);
    loadingRef.current = false;
  }, [guildId]);

  // Load the first page once the guild-change effect above has reset the
  // cursor. `loadMore` itself is stable enough for this: it always reads
  // the latest `cursor` and `done` through the closure it was built with.
  useEffect(() => {
    if (cursor === undefined && !done) {
      void loadMore();
    }
  }, [guildId, cursor, done, loadMore]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) {
        void loadMore();
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMore]);

  function statusOf(userId: string): string {
    if (userId === selfUserId) {
      return chosenStatus === "invisible" ? "offline" : chosenStatus;
    }
    return presences[userId] ?? "offline";
  }

  const list = Object.values(members);
  const online = list.filter((m) => statusOf(m.userId) !== "offline");
  const offline = list.filter((m) => statusOf(m.userId) === "offline");

  return (
    <div className="flex w-60 flex-col overflow-y-auto p-2" style={{ backgroundColor: "var(--color-bg-members)" }}>
      <div className="mb-1 px-2 pt-2 text-xs font-semibold uppercase" style={{ color: "var(--color-text-muted)" }}>
        Online ({online.length})
      </div>
      <ul>
        {online.map((member) => (
          <MemberRow key={member.userId} member={member} status={statusOf(member.userId)} />
        ))}
      </ul>
      <div className="mb-1 mt-3 px-2 text-xs font-semibold uppercase" style={{ color: "var(--color-text-muted)" }}>
        Offline ({offline.length})
      </div>
      <ul>
        {offline.map((member) => (
          <MemberRow key={member.userId} member={member} status="offline" />
        ))}
      </ul>
      <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />
    </div>
  );
}
