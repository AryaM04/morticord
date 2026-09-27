// Typed REST wrappers for guilds, channels, invites and members. Each
// function is a thin call into the shared `ApiClient`, parsed with the
// shared zod schemas, so the server and this client always agree on shape.
import { z } from "zod";
import {
  acceptInviteResultSchema,
  channelOrderRequestSchema,
  channelSchema,
  createChannelRequestSchema,
  createGuildRequestSchema,
  createInviteRequestSchema,
  guildMemberSchema,
  guildViewSchema,
  inviteSchema,
  invitePreviewSchema,
  searchMembersResponseSchema,
  updateChannelRequestSchema,
  updateGuildRequestSchema,
  type AcceptInviteResult,
  type ChannelJson,
  type ChannelOrderRequest,
  type CreateChannelRequest,
  type CreateGuildRequest,
  type CreateInviteRequest,
  type GuildMemberJson,
  type GuildView,
  type InviteJson,
  type InvitePreview,
  type SearchMembersResponse,
  type UpdateChannelRequest,
  type UpdateGuildRequest,
} from "@discord-clone/shared";
import type { ApiClient } from "./api.js";

const membersPageSchema = z.object({ members: z.array(guildMemberSchema) });
const invitesListSchema = z.object({ invites: z.array(inviteSchema) });

export function createGuild(api: ApiClient, input: CreateGuildRequest): Promise<GuildView> {
  createGuildRequestSchema.parse(input);
  return api.request<GuildView>("POST", "/guilds", { body: input, schema: guildViewSchema });
}

export function getGuild(api: ApiClient, guildId: string): Promise<GuildView> {
  return api.request<GuildView>("GET", `/guilds/${guildId}`, { schema: guildViewSchema });
}

export function updateGuild(api: ApiClient, guildId: string, input: UpdateGuildRequest): Promise<GuildView> {
  updateGuildRequestSchema.parse(input);
  return api.request<GuildView>("PATCH", `/guilds/${guildId}`, { body: input, schema: guildViewSchema });
}

export function deleteGuild(api: ApiClient, guildId: string): Promise<void> {
  return api.request("DELETE", `/guilds/${guildId}`);
}

export function leaveGuild(api: ApiClient, guildId: string): Promise<void> {
  return api.request("DELETE", `/guilds/${guildId}/members/@me`);
}

export function uploadGuildIcon(api: ApiClient, guildId: string, file: Blob): Promise<GuildView> {
  const contentType = file.type || "application/octet-stream";
  return api.request<GuildView>("PUT", `/guilds/${guildId}/icon`, {
    rawBody: { data: file, contentType },
    schema: guildViewSchema,
  });
}

export function removeGuildIcon(api: ApiClient, guildId: string): Promise<GuildView> {
  return api.request<GuildView>("DELETE", `/guilds/${guildId}/icon`, { schema: guildViewSchema });
}

export interface ListMembersOptions {
  after?: string;
  limit?: number;
}

/** One keyset page of a guild's members, ordered by user id. */
export function listGuildMembers(
  api: ApiClient,
  guildId: string,
  options: ListMembersOptions = {},
): Promise<{ members: GuildMemberJson[] }> {
  const query = new URLSearchParams();
  if (options.after) {
    query.set("after", options.after);
  }
  if (options.limit) {
    query.set("limit", String(options.limit));
  }
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return api.request("GET", `/guilds/${guildId}/members${suffix}`, { schema: membersPageSchema });
}

/** Case-insensitive prefix search over a guild's members, for the mention autocomplete. */
export function searchGuildMembers(
  api: ApiClient,
  guildId: string,
  q: string,
  limit = 10,
): Promise<SearchMembersResponse> {
  const query = new URLSearchParams({ q, limit: String(limit) });
  return api.request("GET", `/guilds/${guildId}/members/search?${query.toString()}`, {
    schema: searchMembersResponseSchema,
  });
}

export function createChannel(
  api: ApiClient,
  guildId: string,
  input: CreateChannelRequest,
): Promise<ChannelJson> {
  createChannelRequestSchema.parse(input);
  return api.request<ChannelJson>("POST", `/guilds/${guildId}/channels`, { body: input, schema: channelSchema });
}

/** Send one bulk order request for every channel that moved in a drag-and-drop reorder. */
export function reorderChannels(api: ApiClient, guildId: string, input: ChannelOrderRequest): Promise<void> {
  channelOrderRequestSchema.parse(input);
  return api.request("PUT", `/guilds/${guildId}/channels/order`, { body: input });
}

export function updateChannel(api: ApiClient, channelId: string, input: UpdateChannelRequest): Promise<ChannelJson> {
  updateChannelRequestSchema.parse(input);
  return api.request<ChannelJson>("PATCH", `/channels/${channelId}`, { body: input, schema: channelSchema });
}

export function deleteChannel(api: ApiClient, channelId: string): Promise<void> {
  return api.request("DELETE", `/channels/${channelId}`);
}

export function createInvite(api: ApiClient, channelId: string, input: CreateInviteRequest): Promise<InviteJson> {
  createInviteRequestSchema.parse(input);
  return api.request<InviteJson>("POST", `/channels/${channelId}/invites`, { body: input, schema: inviteSchema });
}

export function listGuildInvites(api: ApiClient, guildId: string): Promise<{ invites: InviteJson[] }> {
  return api.request("GET", `/guilds/${guildId}/invites`, { schema: invitesListSchema });
}

export function getInvitePreview(api: ApiClient, code: string): Promise<InvitePreview> {
  return api.request<InvitePreview>("GET", `/invites/${code}`, { schema: invitePreviewSchema });
}

export function acceptInvite(api: ApiClient, code: string): Promise<AcceptInviteResult> {
  return api.request<AcceptInviteResult>("POST", `/invites/${code}`, { schema: acceptInviteResultSchema });
}

export function deleteInvite(api: ApiClient, code: string): Promise<void> {
  return api.request("DELETE", `/invites/${code}`);
}
