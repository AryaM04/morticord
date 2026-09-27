// Guild, channel and invite routes. Each handler validates input, checks
// membership and permissions inside the service call, and replies.
import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import {
  createChannelRequestSchema,
  createGuildRequestSchema,
  createInviteRequestSchema,
  listMembersQuerySchema,
  searchMembersQuerySchema,
  updateChannelRequestSchema,
  updateGuildRequestSchema,
  channelOrderRequestSchema,
} from "@discord-clone/shared";
import type { AppDeps } from "../../app.js";
import { guilds } from "../../db/schema.js";
import { AppError } from "../../errors.js";
import { detectImageContentType } from "../users/avatar.js";
import {
  createChannel,
  deleteChannel,
  reorderChannels,
  updateChannel,
} from "./channels.js";
import {
  acceptInvite,
  createInvite,
  deleteInvite,
  getInvitePreview,
  listGuildInvites,
} from "./invites.js";
import { readIconFile } from "./icon.js";
import {
  createGuild,
  deleteGuild,
  getGuildView,
  leaveGuild,
  listMembers,
  removeGuildIcon,
  searchMembers,
  setGuildIcon,
  updateGuild,
} from "./service.js";
import { toChannelJson, toInviteJson, toInvitePreviewJson, toMemberJson } from "./serialize.js";

const ICON_BODY_LIMIT_BYTES = 1024 * 1024; // 1 MiB

function parseId(text: string): bigint {
  if (!/^[0-9]+$/.test(text)) {
    throw new AppError(404, "NOT_FOUND", "This does not exist.");
  }
  return BigInt(text);
}

export async function registerGuildRoutes(app: FastifyInstance, deps: AppDeps): Promise<void> {
  const guildsDeps = { db: deps.db, config: deps.config, gateway: deps.gateway };

  app.post("/guilds", { preHandler: app.authenticate }, async (request, reply) => {
    const input = createGuildRequestSchema.parse(request.body);
    const guild = await createGuild(guildsDeps, request.auth!.userId, input.name);
    return reply.status(201).send(guild);
  });

  app.get("/guilds/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const guildId = parseId((request.params as { id: string }).id);
    const guild = await getGuildView(deps.db, guildId, request.auth!.userId);
    return reply.send(guild);
  });

  app.patch("/guilds/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const guildId = parseId((request.params as { id: string }).id);
    const input = updateGuildRequestSchema.parse(request.body);
    const guild = await updateGuild(guildsDeps, guildId, request.auth!.userId, input);
    return reply.send(guild);
  });

  app.delete("/guilds/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const guildId = parseId((request.params as { id: string }).id);
    await deleteGuild(guildsDeps, guildId, request.auth!.userId);
    return reply.status(204).send();
  });

  app.put(
    "/guilds/:id/icon",
    { preHandler: app.authenticate, bodyLimit: ICON_BODY_LIMIT_BYTES },
    async (request, reply) => {
      const guildId = parseId((request.params as { id: string }).id);
      const buffer = request.body as Buffer;
      if (!detectImageContentType(buffer)) {
        throw new AppError(400, "INVALID_IMAGE", "The file is not a PNG, JPEG or WEBP image.");
      }
      const guild = await setGuildIcon(guildsDeps, guildId, request.auth!.userId, buffer);
      return reply.send(guild);
    },
  );

  app.delete("/guilds/:id/icon", { preHandler: app.authenticate }, async (request, reply) => {
    const guildId = parseId((request.params as { id: string }).id);
    const guild = await removeGuildIcon(guildsDeps, guildId, request.auth!.userId);
    return reply.send(guild);
  });

  app.get("/icons/:guildId/:iconKey", async (request, reply) => {
    const { guildId: guildIdText, iconKey } = request.params as { guildId: string; iconKey: string };
    if (!/^[0-9]+$/.test(guildIdText)) {
      throw new AppError(404, "NOT_FOUND", "This icon does not exist.");
    }
    const guildId = BigInt(guildIdText);

    const rows = await deps.db.select({ iconKey: guilds.iconKey }).from(guilds).where(eq(guilds.id, guildId)).limit(1);
    if (!rows[0] || rows[0].iconKey !== iconKey) {
      throw new AppError(404, "NOT_FOUND", "This icon does not exist.");
    }

    const buffer = await readIconFile(deps.config.dataDir, guildId);
    if (!buffer) {
      throw new AppError(404, "NOT_FOUND", "This icon does not exist.");
    }

    const contentType = detectImageContentType(buffer) ?? "application/octet-stream";
    reply.header("Cache-Control", "public, max-age=31536000, immutable");
    reply.header("Content-Type", contentType);
    return reply.send(buffer);
  });

  app.get("/guilds/:id/members", { preHandler: app.authenticate }, async (request, reply) => {
    const guildId = parseId((request.params as { id: string }).id);
    const query = listMembersQuerySchema.parse(request.query);
    const rows = await listMembers(deps.db, guildId, request.auth!.userId, {
      after: query.after ? BigInt(query.after) : undefined,
      limit: query.limit,
    });
    return reply.send({ members: rows.map((row) => toMemberJson(row, row.roleIds)) });
  });

  app.get("/guilds/:id/members/search", { preHandler: app.authenticate }, async (request, reply) => {
    const guildId = parseId((request.params as { id: string }).id);
    const query = searchMembersQuerySchema.parse(request.query);
    const rows = await searchMembers(deps.db, guildId, request.auth!.userId, { q: query.q, limit: query.limit });
    return reply.send({ members: rows.map((row) => toMemberJson(row, row.roleIds)) });
  });

  app.delete("/guilds/:id/members/@me", { preHandler: app.authenticate }, async (request, reply) => {
    const guildId = parseId((request.params as { id: string }).id);
    await leaveGuild(guildsDeps, guildId, request.auth!.userId);
    return reply.status(204).send();
  });

  app.post("/guilds/:id/channels", { preHandler: app.authenticate }, async (request, reply) => {
    const guildId = parseId((request.params as { id: string }).id);
    const input = createChannelRequestSchema.parse(request.body);
    const channel = await createChannel(
      deps.db,
      guildId,
      request.auth!.userId,
      {
        name: input.name,
        type: input.type,
        parentId: input.parentId ? BigInt(input.parentId) : null,
        topic: input.topic,
      },
      deps.gateway,
    );
    return reply.status(201).send(toChannelJson(channel));
  });

  app.put("/guilds/:id/channels/order", { preHandler: app.authenticate }, async (request, reply) => {
    const guildId = parseId((request.params as { id: string }).id);
    const input = channelOrderRequestSchema.parse(request.body);
    await reorderChannels(
      deps.db,
      guildId,
      request.auth!.userId,
      input.map((entry) => ({
        id: BigInt(entry.id),
        position: entry.position,
        parentId: entry.parentId ? BigInt(entry.parentId) : null,
      })),
    );
    return reply.status(204).send();
  });

  app.patch("/channels/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const channelId = parseId((request.params as { id: string }).id);
    const input = updateChannelRequestSchema.parse(request.body);
    const channel = await updateChannel(
      deps.db,
      channelId,
      request.auth!.userId,
      {
        name: input.name,
        topic: input.topic,
        parentId: input.parentId === undefined ? undefined : input.parentId ? BigInt(input.parentId) : null,
      },
      deps.gateway,
    );
    return reply.send(toChannelJson(channel));
  });

  app.delete("/channels/:id", { preHandler: app.authenticate }, async (request, reply) => {
    const channelId = parseId((request.params as { id: string }).id);
    await deleteChannel(deps.db, channelId, request.auth!.userId, deps.gateway);
    return reply.status(204).send();
  });

  app.post("/channels/:id/invites", { preHandler: app.authenticate }, async (request, reply) => {
    const channelId = parseId((request.params as { id: string }).id);
    const input = createInviteRequestSchema.parse(request.body ?? {});
    const invite = await createInvite(deps.db, channelId, request.auth!.userId, input);
    return reply.status(201).send(toInviteJson(invite));
  });

  app.get("/guilds/:id/invites", { preHandler: app.authenticate }, async (request, reply) => {
    const guildId = parseId((request.params as { id: string }).id);
    const rows = await listGuildInvites(deps.db, guildId, request.auth!.userId);
    return reply.send({ invites: rows.map(toInviteJson) });
  });

  app.get("/invites/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const preview = await getInvitePreview(deps.db, code);
    return reply.send(toInvitePreviewJson(preview));
  });

  app.post("/invites/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    const guild = await acceptInvite(deps.db, code, request.auth!.userId, deps.gateway);
    return reply.status(200).send({ guild });
  });

  app.delete("/invites/:code", { preHandler: app.authenticate }, async (request, reply) => {
    const { code } = request.params as { code: string };
    await deleteInvite(deps.db, code, request.auth!.userId);
    return reply.status(204).send();
  });
}
