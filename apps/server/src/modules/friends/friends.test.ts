// Integration tests for friends and blocks: the REST flows, the gateway
// dispatches, and friend presence without a shared guild. Real Postgres and
// a real `ws` client.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { describeWithDb } from "../../../test/db.js";
import { GatewayService } from "../gateway/service.js";
import {
  apiFor,
  connectGateway,
  makeFriends,
  registerUser,
  startTestServer,
  type GatewayClient,
  type TestServer,
} from "../../../test/social.js";

vi.setConfig({ testTimeout: 15_000 });

let server: TestServer;
const sockets: GatewayClient[] = [];

async function connect(user: Parameters<typeof connectGateway>[1]): Promise<GatewayClient> {
  const client = await connectGateway(server, user);
  sockets.push(client);
  return client;
}

describeWithDb("friends", () => {
  beforeAll(async () => {
    server = await startTestServer();
  });

  afterEach(() => {
    for (const socket of sockets.splice(0)) {
      socket.close();
    }
  });

  afterAll(async () => {
    await server.close();
  });

  it("sends a request, and both users see it in the list and on the gateway", async () => {
    const alice = await registerUser(server, "alice");
    const bob = await registerUser(server, "bob");
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);

    const sent = await apiFor(server, alice).post("/users/@me/relationships", { username: bob.username });
    expect(sent.status).toBe(201);
    expect(sent.body).toMatchObject({ userId: bob.userId, status: "pending_outgoing", user: { username: bob.username } });
    expect(sent.body.user.email).toBeUndefined();

    const aliceEvent = await aliceSocket.event("RELATIONSHIP_ADD");
    expect(aliceEvent).toMatchObject({ userId: bob.userId, status: "pending_outgoing" });
    const bobEvent = await bobSocket.event("RELATIONSHIP_ADD");
    expect(bobEvent).toMatchObject({ userId: alice.userId, status: "pending_incoming", user: { username: alice.username } });

    const aliceList = await apiFor(server, alice).get("/users/@me/relationships");
    expect(aliceList.body.relationships).toHaveLength(1);
    expect(aliceList.body.relationships[0].status).toBe("pending_outgoing");
    const bobList = await apiFor(server, bob).get("/users/@me/relationships");
    expect(bobList.body.relationships[0]).toMatchObject({ userId: alice.userId, status: "pending_incoming" });
  });

  it("puts the relationships in READY", async () => {
    const alice = await registerUser(server, "ready");
    const bob = await registerUser(server, "ready");
    await makeFriends(server, alice, bob);
    const socket = await connect(alice);
    const ready = socket.ready.d as { relationships: Array<{ userId: string; status: string }> };
    expect(ready.relationships).toEqual([expect.objectContaining({ userId: bob.userId, status: "accepted" })]);
  });

  it("rejects a duplicate request, an unknown user and a request to self", async () => {
    const alice = await registerUser(server, "dup");
    const bob = await registerUser(server, "dup");
    const api = apiFor(server, alice);
    await api.post("/users/@me/relationships", { username: bob.username });

    const again = await api.post("/users/@me/relationships", { username: bob.username });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("REQUEST_ALREADY_SENT");

    const unknown = await api.post("/users/@me/relationships", { username: "nobody.here" });
    expect(unknown.status).toBe(404);
    expect(unknown.body.error.code).toBe("USER_NOT_FOUND");

    const self = await api.post("/users/@me/relationships", { username: alice.username });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe("CANNOT_FRIEND_SELF");

    await apiFor(server, bob).put(`/users/@me/relationships/${alice.userId}`, { action: "accept" });
    const friends = await api.post("/users/@me/relationships", { username: bob.username });
    expect(friends.status).toBe(409);
    expect(friends.body.error.code).toBe("ALREADY_FRIENDS");
  });

  it("accepts a request, and both users get an accepted relationship", async () => {
    const alice = await registerUser(server, "acc");
    const bob = await registerUser(server, "acc");
    const aliceSocket = await connect(alice);
    await apiFor(server, alice).post("/users/@me/relationships", { username: bob.username });
    aliceSocket.drain();

    const bobSocket = await connect(bob);
    const accepted = await apiFor(server, bob).put(`/users/@me/relationships/${alice.userId}`, { action: "accept" });
    expect(accepted.status).toBe(200);
    expect(accepted.body).toMatchObject({ userId: alice.userId, status: "accepted" });

    expect(await aliceSocket.event("RELATIONSHIP_ADD", (d) => d.status === "accepted")).toMatchObject({ userId: bob.userId });
    expect(await bobSocket.event("RELATIONSHIP_ADD", (d) => d.status === "accepted")).toMatchObject({ userId: alice.userId });

    const list = await apiFor(server, alice).get("/users/@me/relationships");
    expect(list.body.relationships[0].status).toBe("accepted");
  });

  it("answers 404 when the caller accepts a request that does not exist", async () => {
    const alice = await registerUser(server, "noreq");
    const bob = await registerUser(server, "noreq");
    await apiFor(server, alice).post("/users/@me/relationships", { username: bob.username });
    // Alice sent the request, so Alice cannot accept it.
    const result = await apiFor(server, alice).put(`/users/@me/relationships/${bob.userId}`, { action: "accept" });
    expect(result.status).toBe(404);
    expect(result.body.error.code).toBe("REQUEST_NOT_FOUND");
  });

  it("accepts both requests at once when two users send a request to each other", async () => {
    const alice = await registerUser(server, "mutual");
    const bob = await registerUser(server, "mutual");
    await apiFor(server, alice).post("/users/@me/relationships", { username: bob.username });
    const back = await apiFor(server, bob).post("/users/@me/relationships", { username: alice.username });
    expect(back.status).toBe(200);
    expect(back.body.status).toBe("accepted");

    for (const [user, other] of [
      [alice, bob],
      [bob, alice],
    ] as const) {
      const list = await apiFor(server, user).get("/users/@me/relationships");
      expect(list.body.relationships).toEqual([expect.objectContaining({ userId: other.userId, status: "accepted" })]);
    }
  });

  it("stays consistent when two users send a request to each other at the same time", async () => {
    const alice = await registerUser(server, "race");
    const bob = await registerUser(server, "race");
    const [first, second] = await Promise.all([
      apiFor(server, alice).post("/users/@me/relationships", { username: bob.username }),
      apiFor(server, bob).post("/users/@me/relationships", { username: alice.username }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 201]);
    const list = await apiFor(server, alice).get("/users/@me/relationships");
    expect(list.body.relationships).toEqual([expect.objectContaining({ userId: bob.userId, status: "accepted" })]);
  });

  it("declines and cancels a request with DELETE", async () => {
    const alice = await registerUser(server, "cancel");
    const bob = await registerUser(server, "cancel");
    const carol = await registerUser(server, "cancel");
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);

    await apiFor(server, alice).post("/users/@me/relationships", { username: bob.username });
    await apiFor(server, carol).post("/users/@me/relationships", { username: alice.username });
    aliceSocket.drain();
    bobSocket.drain();

    // Alice cancels her own request to Bob.
    expect((await apiFor(server, alice).del(`/users/@me/relationships/${bob.userId}`)).status).toBe(204);
    expect(await aliceSocket.event("RELATIONSHIP_REMOVE")).toEqual({ userId: bob.userId });
    expect(await bobSocket.event("RELATIONSHIP_REMOVE")).toEqual({ userId: alice.userId });

    // Alice declines the request from Carol.
    expect((await apiFor(server, alice).del(`/users/@me/relationships/${carol.userId}`)).status).toBe(204);
    for (const user of [alice, bob, carol]) {
      const list = await apiFor(server, user).get("/users/@me/relationships");
      expect(list.body.relationships).toEqual([]);
    }

    const missing = await apiFor(server, alice).del(`/users/@me/relationships/${bob.userId}`);
    expect(missing.status).toBe(404);
  });

  it("unfriends, and both users get RELATIONSHIP_REMOVE", async () => {
    const alice = await registerUser(server, "unf");
    const bob = await registerUser(server, "unf");
    await makeFriends(server, alice, bob);
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);

    expect((await apiFor(server, bob).del(`/users/@me/relationships/${alice.userId}`)).status).toBe(204);
    expect(await aliceSocket.event("RELATIONSHIP_REMOVE")).toEqual({ userId: bob.userId });
    expect(await bobSocket.event("RELATIONSHIP_REMOVE")).toEqual({ userId: alice.userId });
    const list = await apiFor(server, alice).get("/users/@me/relationships");
    expect(list.body.relationships).toEqual([]);
  });

  it("hides a blocker from the blocked user", async () => {
    const alice = await registerUser(server, "blk");
    const bob = await registerUser(server, "blk");
    await makeFriends(server, alice, bob);
    const aliceSocket = await connect(alice);
    const bobSocket = await connect(bob);

    const blocked = await apiFor(server, alice).put(`/users/@me/relationships/${bob.userId}`, { action: "block" });
    expect(blocked.status).toBe(200);
    expect(blocked.body.status).toBe("blocked");
    expect(await aliceSocket.event("RELATIONSHIP_ADD", (d) => d.status === "blocked")).toMatchObject({ userId: bob.userId });
    // Bob sees the friendship end. Bob never sees a "blocked" status.
    expect(await bobSocket.event("RELATIONSHIP_REMOVE")).toEqual({ userId: alice.userId });
    expect(await bobSocket.never("RELATIONSHIP_ADD")).toBe(true);

    const aliceList = await apiFor(server, alice).get("/users/@me/relationships");
    expect(aliceList.body.relationships).toEqual([expect.objectContaining({ userId: bob.userId, status: "blocked" })]);
    const bobList = await apiFor(server, bob).get("/users/@me/relationships");
    expect(bobList.body.relationships).toEqual([]);

    // Bob cannot send a request. The answer is the same as for a missing user.
    const request = await apiFor(server, bob).post("/users/@me/relationships", { username: alice.username });
    expect(request.status).toBe(404);
    expect(request.body.error.code).toBe("USER_NOT_FOUND");

    // Alice cannot send a request until she unblocks.
    const own = await apiFor(server, alice).post("/users/@me/relationships", { username: bob.username });
    expect(own.status).toBe(409);
    expect(own.body.error.code).toBe("USER_BLOCKED");

    expect((await apiFor(server, alice).del(`/users/@me/relationships/${bob.userId}`)).status).toBe(204);
    const again = await apiFor(server, bob).post("/users/@me/relationships", { username: alice.username });
    expect(again.status).toBe(201);
  });

  it("keeps a block that the other user made when one user unblocks", async () => {
    const alice = await registerUser(server, "both");
    const bob = await registerUser(server, "both");
    await apiFor(server, alice).put(`/users/@me/relationships/${bob.userId}`, { action: "block" });
    await apiFor(server, bob).put(`/users/@me/relationships/${alice.userId}`, { action: "block" });
    await apiFor(server, alice).del(`/users/@me/relationships/${bob.userId}`);

    const bobList = await apiFor(server, bob).get("/users/@me/relationships");
    expect(bobList.body.relationships).toEqual([expect.objectContaining({ userId: alice.userId, status: "blocked" })]);
    const request = await apiFor(server, alice).post("/users/@me/relationships", { username: bob.username });
    expect(request.status).toBe(404);
  });

  it("rejects a bad action and a block of self", async () => {
    const alice = await registerUser(server, "bad");
    const bad = await apiFor(server, alice).put(`/users/@me/relationships/123`, { action: "poke" });
    expect(bad.status).toBe(400);
    const self = await apiFor(server, alice).put(`/users/@me/relationships/${alice.userId}`, { action: "block" });
    expect(self.status).toBe(400);
    const missing = await apiFor(server, alice).put(`/users/@me/relationships/999999999`, { action: "block" });
    expect(missing.status).toBe(404);
  });

  it("limits friend requests to 10 in one minute", async () => {
    const alice = await registerUser(server, "rate");
    const targets = await Promise.all(Array.from({ length: 11 }, () => registerUser(server, "target")));
    const api = apiFor(server, alice);
    for (const target of targets.slice(0, 10)) {
      expect((await api.post("/users/@me/relationships", { username: target.username })).status).toBe(201);
    }
    const limited = await api.post("/users/@me/relationships", { username: targets[10]!.username });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
  });

  describe("presence", () => {
    it("shows an online friend in READY, with no shared guild", async () => {
      const alice = await registerUser(server, "pres");
      const bob = await registerUser(server, "pres");
      const stranger = await registerUser(server, "pres");
      await makeFriends(server, alice, bob);
      await connect(bob);
      await connect(stranger);

      const aliceSocket = await connect(alice);
      const presences = (aliceSocket.ready.d as { presences: Array<{ userId: string; status: string }> }).presences;
      expect(presences).toContainEqual({ userId: bob.userId, status: "online" });
      expect(presences.map((entry) => entry.userId)).not.toContain(stranger.userId);
    });

    it("sends PRESENCE_UPDATE to friends only when a user goes online or offline", async () => {
      const alice = await registerUser(server, "live");
      const bob = await registerUser(server, "live");
      const stranger = await registerUser(server, "live");
      await makeFriends(server, alice, bob);
      const aliceSocket = await connect(alice);
      const strangerSocket = await connect(stranger);

      const bobSocket = await connect(bob);
      expect(await aliceSocket.event("PRESENCE_UPDATE", (d) => d.userId === bob.userId)).toEqual({
        userId: bob.userId,
        status: "online",
      });
      bobSocket.close();
      expect(await aliceSocket.event("PRESENCE_UPDATE", (d) => d.userId === bob.userId && d.status === "offline")).toBeTruthy();
      expect(await strangerSocket.never("PRESENCE_UPDATE", (d) => d.userId === bob.userId)).toBe(true);
    });

    it("tells two new friends about each other when the request is accepted", async () => {
      const alice = await registerUser(server, "new");
      const bob = await registerUser(server, "new");
      const aliceSocket = await connect(alice);
      const bobSocket = await connect(bob);
      await apiFor(server, alice).post("/users/@me/relationships", { username: bob.username });
      await apiFor(server, bob).put(`/users/@me/relationships/${alice.userId}`, { action: "accept" });
      expect(await aliceSocket.event("PRESENCE_UPDATE", (d) => d.userId === bob.userId)).toMatchObject({ status: "online" });
      expect(await bobSocket.event("PRESENCE_UPDATE", (d) => d.userId === alice.userId)).toMatchObject({ status: "online" });
    });

    it("loads the friends into a new gateway hub at start", async () => {
      const alice = await registerUser(server, "prime");
      const bob = await registerUser(server, "prime");
      const stranger = await registerUser(server, "prime");
      await makeFriends(server, alice, bob);

      const hub = new GatewayService();
      await hub.primeFromDatabase(server.testDb.db);
      const fakeSocket = { readyState: 1, send: () => undefined, close: () => undefined };
      for (const user of [bob, stranger]) {
        hub.createSession(fakeSocket, BigInt(user.userId), user.deviceId);
      }
      expect(hub.onlinePresencesFor(BigInt(alice.userId))).toEqual([{ userId: bob.userId, status: "online" }]);
    });

    it("stops the presence of a friend after unfriend", async () => {
      const alice = await registerUser(server, "stop");
      const bob = await registerUser(server, "stop");
      await makeFriends(server, alice, bob);
      const aliceSocket = await connect(alice);
      const bobSocket = await connect(bob);
      await apiFor(server, alice).del(`/users/@me/relationships/${bob.userId}`);
      aliceSocket.drain();
      bobSocket.close();
      expect(await aliceSocket.never("PRESENCE_UPDATE", (d) => d.userId === bob.userId, 500)).toBe(true);
    });
  });
});
