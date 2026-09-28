// The main pane's view for the voice channel this tab is connected to: a
// responsive grid of tiles, one per participant, each a video when their
// camera is on or an avatar with a speaking ring when it is not. A screen
// share, local or remote, shows as one large tile above the others.
import { useEffect, useRef } from "react";
import { useStore } from "zustand";
import { useRealtime } from "../lib/useRealtime.js";
import { voiceStore } from "../lib/voice.js";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("") || "?";
}

function VideoTile({
  stream,
  name,
  avatarUrl,
  speaking,
  mirrored,
  large,
}: {
  stream: MediaStream | null;
  name: string;
  avatarUrl?: string;
  speaking: boolean;
  mirrored: boolean;
  large: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const el = videoRef.current;
    if (!el) {
      return;
    }
    el.srcObject = stream;
    return () => {
      el.srcObject = null;
    };
  }, [stream]);

  return (
    <div
      className="relative flex items-center justify-center overflow-hidden rounded"
      style={{
        backgroundColor: "var(--color-bg-sidebar)",
        boxShadow: speaking ? "0 0 0 3px #3ba55d" : undefined,
        aspectRatio: large ? "16 / 9" : "4 / 3",
        minHeight: large ? "240px" : "120px",
      }}
    >
      {stream ? (
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="h-full w-full object-cover"
          style={{ transform: mirrored ? "scaleX(-1)" : undefined }}
        />
      ) : (
        <div
          className="flex items-center justify-center rounded-full font-semibold"
          style={{
            backgroundColor: "var(--color-accent)",
            color: "white",
            width: large ? "96px" : "56px",
            height: large ? "96px" : "56px",
            fontSize: large ? "28px" : "18px",
          }}
          aria-hidden="true"
        >
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="h-full w-full rounded-full object-cover" />
          ) : (
            initialsOf(name)
          )}
        </div>
      )}
      <span
        className="absolute bottom-1 left-1 rounded px-1.5 py-0.5 text-xs"
        style={{ backgroundColor: "rgba(0,0,0,0.55)", color: "white" }}
      >
        {name}
      </span>
    </div>
  );
}

export function VoiceCallView({ guildId, channelId }: { guildId: string; channelId: string }) {
  const states = useRealtime((s) => s.voiceStatesByChannel[channelId]);
  const selfUserId = useRealtime((s) => s.selfUserId);
  const selfMember = useRealtime((s) => s.selfMemberByGuild[guildId]);
  const members = useRealtime((s) => s.membersByGuild[guildId]);
  const voicePeers = useStore(voiceStore, (s) => s.peers);
  const localSpeaking = useStore(voiceStore, (s) => s.localSpeaking);
  const cameraOn = useStore(voiceStore, (s) => s.cameraOn);
  const screenOn = useStore(voiceStore, (s) => s.screenOn);
  const localCameraStream = useStore(voiceStore, (s) => s.localCameraStream);
  const localScreenStream = useStore(voiceStore, (s) => s.localScreenStream);

  const entries = states ? Object.values(states) : [];

  function nameOf(userId: string): { name: string; avatarUrl?: string } {
    const isSelf = userId === selfUserId;
    const member = isSelf ? selfMember : members?.[userId];
    const name = member?.nickname ?? member?.user?.displayName ?? userId;
    const avatarUrl = member?.user?.avatarKey ? `/api/v1/avatars/${userId}/${member.user.avatarKey}` : undefined;
    return { name, avatarUrl };
  }

  const tiles = entries.map((state) => {
    const isSelf = state.userId === selfUserId;
    const { name, avatarUrl } = nameOf(state.userId);
    if (isSelf) {
      return {
        key: "self",
        name,
        avatarUrl,
        speaking: localSpeaking,
        stream: cameraOn ? localCameraStream : null,
        mirrored: true,
      };
    }
    const peer = voicePeers.find((p) => p.userId === state.userId);
    return {
      key: state.userId,
      name,
      avatarUrl,
      speaking: peer?.speaking ?? false,
      stream: peer?.cameraStream ?? null,
      mirrored: false,
    };
  });

  const remoteSharerId = entries.find((state) => {
    if (state.userId === selfUserId) {
      return false;
    }
    return Boolean(voicePeers.find((p) => p.userId === state.userId)?.screenStream);
  })?.userId;

  const screenTile = screenOn
    ? { name: `${nameOf(selfUserId ?? "").name} (you) is sharing their screen`, stream: localScreenStream }
    : remoteSharerId
      ? {
          name: `${nameOf(remoteSharerId).name} is sharing their screen`,
          stream: voicePeers.find((p) => p.userId === remoteSharerId)?.screenStream ?? null,
        }
      : null;

  return (
    <div className="flex flex-1 flex-col gap-3 overflow-y-auto p-3" data-voice-call-view={channelId}>
      {screenTile && (
        <VideoTile stream={screenTile.stream} name={screenTile.name} speaking={false} mirrored={false} large />
      )}
      <div
        className={screenTile ? "flex gap-2 overflow-x-auto" : "grid gap-3"}
        style={
          screenTile
            ? { flexShrink: 0 }
            : { gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }
        }
      >
        {tiles.map((tile) => (
          <div key={tile.key} className={screenTile ? "w-40 flex-shrink-0" : undefined}>
            <VideoTile
              stream={tile.stream}
              name={tile.name}
              avatarUrl={tile.avatarUrl}
              speaking={tile.speaking}
              mirrored={tile.mirrored}
              large={false}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
