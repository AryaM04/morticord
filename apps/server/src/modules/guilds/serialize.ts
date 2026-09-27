// Turn database rows into the JSON shapes the guild API sends.
import type {
  ChannelJson,
  GuildJson,
  GuildMemberJson,
  GuildView,
  InviteJson,
  InvitePreview,
  RoleJson,
} from "@discord-clone/shared";
import type { ChannelRow, GuildRow, RoleRow } from "./member-context.js";

export interface InviteRow {
  code: string;
  guildId: bigint;
  channelId: bigint;
  inviterId: bigint;
  maxUses: number | null;
  uses: number;
  expiresAt: Date | null;
}

export function toGuildJson(guild: GuildRow): GuildJson {
  return {
    id: guild.id.toString(),
    name: guild.name,
    iconKey: guild.iconKey,
    ownerId: guild.ownerId.toString(),
    createdAt: guild.createdAt.toISOString(),
  };
}

export function toRoleJson(role: RoleRow): RoleJson {
  return {
    id: role.id.toString(),
    guildId: role.guildId.toString(),
    name: role.name,
    color: role.color,
    position: role.position,
    permissions: role.permissions.toString(),
    mentionable: role.mentionable,
  };
}

export function toChannelJson(channel: ChannelRow): ChannelJson {
  return {
    id: channel.id.toString(),
    guildId: (channel.guildId ?? 0n).toString(),
    type: channel.type as "text" | "voice" | "category",
    name: channel.name,
    topic: channel.topic,
    position: channel.position,
    parentId: channel.parentId?.toString() ?? null,
  };
}

export interface MemberRow {
  guildId: bigint;
  userId: bigint;
  nickname: string | null;
  joinedAt: Date;
}

export function toMemberJson(member: MemberRow, roleIds: bigint[]): GuildMemberJson {
  return {
    guildId: member.guildId.toString(),
    userId: member.userId.toString(),
    nickname: member.nickname,
    joinedAt: member.joinedAt.toISOString(),
    roles: roleIds.map((id) => id.toString()),
  };
}

export function toInviteJson(invite: InviteRow): InviteJson {
  return {
    code: invite.code,
    guildId: invite.guildId.toString(),
    channelId: invite.channelId.toString(),
    inviterId: invite.inviterId.toString(),
    maxUses: invite.maxUses,
    uses: invite.uses,
    expiresAt: invite.expiresAt?.toISOString() ?? null,
  };
}

export interface InvitePreviewRow {
  code: string;
  guild: { id: bigint; name: string; iconKey: string | null };
  channel: { id: bigint; name: string | null };
  inviter: { id: bigint; username: string; displayName: string; avatarKey: string | null };
  memberCount: number;
  expiresAt: Date | null;
}

export function toInvitePreviewJson(preview: InvitePreviewRow): InvitePreview {
  return {
    code: preview.code,
    guild: { id: preview.guild.id.toString(), name: preview.guild.name, iconKey: preview.guild.iconKey },
    channel: { id: preview.channel.id.toString(), name: preview.channel.name },
    inviter: {
      id: preview.inviter.id.toString(),
      username: preview.inviter.username,
      displayName: preview.inviter.displayName,
      avatarKey: preview.inviter.avatarKey,
    },
    memberCount: preview.memberCount,
    expiresAt: preview.expiresAt?.toISOString() ?? null,
  };
}

export function toGuildView(
  guild: GuildRow,
  roles: RoleRow[],
  channelsList: ChannelRow[],
  member: MemberRow,
  memberRoleIds: bigint[],
): GuildView {
  return {
    ...toGuildJson(guild),
    roles: roles.map(toRoleJson),
    channels: channelsList.map(toChannelJson),
    member: toMemberJson(member, memberRoleIds),
  };
}
