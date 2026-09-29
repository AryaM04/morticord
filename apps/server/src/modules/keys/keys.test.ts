// Integration tests for the key server: upload, signature checks, identity
// key rules, the atomic one-time key claim, query visibility, the master
// key and the DEVICE_LIST_UPDATE fan-out. Real Postgres and a real ws.
import { afterAll, beforeAll, expect, it } from "vitest";
import { describeWithDb } from "../../../test/db.js";
import { randomCurveKey, shareGuild, TestDeviceKeys, TestSigner } from "../../../test/keys.js";
import {
  apiFor,
  connectGateway,
  loginNewDevice,
  makeFriends,
  registerUser,
  startTestServer,
  type TestServer,
} from "../../../test/social.js";

let server: TestServer;

describeWithDb("key server", () => {
  beforeAll(async () => {
    server = await startTestServer();
  });

  afterAll(async () => {
    await server.close();
  });

  it("stores signed device keys once and rejects a bad signature or new keys", async () => {
    const alice = await registerUser(server, "keysa");
    const api = apiFor(server, alice);
    const keys = new TestDeviceKeys(alice);

    const forged = { ...keys.deviceKeys, signature: new TestSigner().sign("x") };
    expect((await api.post("/keys/upload", { deviceKeys: forged })).body.error.code).toBe("INVALID_SIGNATURE");

    // A signature made for a different device id does not verify for this device.
    const otherDevice = new TestDeviceKeys({ ...alice, deviceId: "some-other-device" });
    const moved = { ...otherDevice.deviceKeys };
    expect((await api.post("/keys/upload", { deviceKeys: moved })).status).toBe(400);

    const first = await api.post("/keys/upload", { deviceKeys: keys.deviceKeys });
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ oneTimeKeyCount: 0, needsFallbackKey: true });
    expect((await api.post("/keys/upload", { deviceKeys: keys.deviceKeys })).status).toBe(200);

    const replaced = await api.post("/keys/upload", { deviceKeys: new TestDeviceKeys(alice).deviceKeys });
    expect(replaced.status).toBe(409);
    expect(replaced.body.error.code).toBe("DEVICE_KEYS_EXIST");

    const garbage = await api.post("/keys/upload", { deviceKeys: { curve25519: "x", ed25519: "y", signature: "z" } });
    expect(garbage.status).toBe(400);
  });

  it("keeps signed one-time keys up to the cap and checks each signature", async () => {
    const bob = await registerUser(server, "keysb");
    const api = apiFor(server, bob);
    const keys = new TestDeviceKeys(bob);

    const early = await api.post("/keys/upload", { oneTimeKeys: keys.oneTimeKeys(1) });
    expect(early.body.error.code).toBe("DEVICE_KEYS_MISSING");

    await keys.upload(server);
    const batch = keys.oneTimeKeys(50);
    expect((await api.post("/keys/upload", { oneTimeKeys: batch, fallbackKey: keys.fallbackKey() })).body).toEqual({
      oneTimeKeyCount: 50,
      needsFallbackKey: false,
    });
    // The same keys again change nothing.
    expect((await api.post("/keys/upload", { oneTimeKeys: batch })).body.oneTimeKeyCount).toBe(50);

    const tooMany = await api.post("/keys/upload", { oneTimeKeys: keys.oneTimeKeys(51) });
    expect(tooMany.body.error.code).toBe("TOO_MANY_ONE_TIME_KEYS");

    const forged = keys.oneTimeKeys(1);
    const [keyId] = Object.keys(forged);
    forged[keyId!]!.key = randomCurveKey();
    expect((await api.post("/keys/upload", { oneTimeKeys: forged })).body.error.code).toBe("INVALID_SIGNATURE");
    expect((await api.post("/keys/upload", {})).body.oneTimeKeyCount).toBe(50);
  });

  it("gives each one-time key to one claimer only, then the fallback key", async () => {
    const owner = await registerUser(server, "claimo");
    const claimer = await registerUser(server, "claimc");
    await makeFriends(server, owner, claimer);
    const keys = await new TestDeviceKeys(owner).upload(server);
    const ownerApi = apiFor(server, owner);
    const fallback = keys.fallbackKey();
    await ownerApi.post("/keys/upload", { oneTimeKeys: keys.oneTimeKeys(5), fallbackKey: fallback });

    const claimerApi = apiFor(server, claimer);
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        claimerApi.post("/keys/claim", { devices: [{ userId: owner.userId, deviceId: owner.deviceId }] }),
      ),
    );
    const claimed = results.map((result) => {
      expect(result.status).toBe(200);
      expect(result.body.keys).toHaveLength(1);
      return result.body.keys[0];
    });
    const oneTime = claimed.filter((key) => !key.fallback);
    expect(oneTime).toHaveLength(5);
    expect(new Set(oneTime.map((key) => key.keyId)).size).toBe(5);
    const fallbacks = claimed.filter((key) => key.fallback);
    expect(fallbacks).toHaveLength(15);
    expect(fallbacks.every((key) => key.key === fallback.key)).toBe(true);

    expect((await ownerApi.post("/keys/upload", {})).body).toEqual({ oneTimeKeyCount: 0, needsFallbackKey: true });
    const next = keys.fallbackKey("fallback2");
    expect((await ownerApi.post("/keys/upload", { fallbackKey: next })).body.needsFallbackKey).toBe(false);
  });

  it("shows device keys only to users who share a guild, a DM or a friendship", async () => {
    const alice = await registerUser(server, "visa");
    const friend = await registerUser(server, "visf");
    const guildMate = await registerUser(server, "visg");
    const dmPeer = await registerUser(server, "visd");
    const stranger = await registerUser(server, "viss");
    await makeFriends(server, alice, friend);
    await shareGuild(server, alice, [guildMate]);
    const dm = await apiFor(server, alice).post("/users/@me/channels", { recipientIds: [dmPeer.userId] });
    expect(dm.status).toBeLessThan(300);

    for (const user of [alice, friend, guildMate, dmPeer, stranger]) {
      await new TestDeviceKeys(user).upload(server);
    }
    const ids = [alice, friend, guildMate, dmPeer, stranger].map((user) => user.userId);
    const result = await apiFor(server, alice).post("/keys/query", { userIds: ids });
    expect(result.status).toBe(200);
    const seen = result.body.users.map((user: { userId: string }) => user.userId).sort();
    expect(seen).toEqual([alice.userId, friend.userId, guildMate.userId, dmPeer.userId].sort());
    const friendEntry = result.body.users.find((user: { userId: string }) => user.userId === friend.userId);
    expect(friendEntry.devices).toHaveLength(1);
    expect(friendEntry.masterKey).toBeNull();

    const claim = await apiFor(server, alice).post("/keys/claim", {
      devices: [{ userId: stranger.userId, deviceId: stranger.deviceId }],
    });
    expect(claim.body.keys).toEqual([]);
  });

  it("drops a signed-out device from the device list", async () => {
    const carol = await registerUser(server, "rmc");
    const second = await loginNewDevice(server, carol);
    await new TestDeviceKeys(carol).upload(server);
    const secondKeys = await new TestDeviceKeys(second).upload(server);
    await apiFor(server, second).post("/keys/upload", { oneTimeKeys: secondKeys.oneTimeKeys(3) });

    const before = await apiFor(server, carol).post("/keys/query", { userIds: [carol.userId] });
    expect(before.body.users[0].devices).toHaveLength(2);

    await apiFor(server, second).post("/auth/logout");
    const after = await apiFor(server, carol).post("/keys/query", { userIds: [carol.userId] });
    expect(after.body.users[0].devices.map((device: { deviceId: string }) => device.deviceId)).toEqual([carol.deviceId]);

    // The removed device cannot upload again with its old access token.
    expect((await apiFor(server, second).post("/keys/upload", {})).body.error.code).toBe("DEVICE_REMOVED");
  });

  it("sets the master key once and shows the master signature of the device", async () => {
    const dana = await registerUser(server, "mkd");
    const keys = await new TestDeviceKeys(dana).upload(server);
    const api = apiFor(server, dana);
    const master = new TestSigner();

    const badBody = { ...keys.masterBody(master), deviceSignature: new TestSigner().sign("x") };
    expect((await api.put("/keys/master", badBody)).body.error.code).toBe("INVALID_SIGNATURE");

    expect((await api.put("/keys/master", keys.masterBody(master))).status).toBe(204);
    expect((await api.put("/keys/master", keys.masterBody(master))).status).toBe(204);
    const changed = await api.put("/keys/master", keys.masterBody(new TestSigner()));
    expect(changed.status).toBe(409);
    expect(changed.body.error.code).toBe("MASTER_KEY_EXISTS");

    const result = await api.post("/keys/query", { userIds: [dana.userId] });
    const entry = result.body.users[0];
    expect(entry.masterKey.publicKey).toBe(master.publicKey);
    expect(entry.masterKey.deviceId).toBe(dana.deviceId);
    expect(entry.devices[0].masterSignature).toBe(keys.masterBody(master).masterSignature);
  });

  it("sends the one-time key count in READY", async () => {
    const erin = await registerUser(server, "rdy");
    const keys = await new TestDeviceKeys(erin).upload(server);
    await apiFor(server, erin).post("/keys/upload", { oneTimeKeys: keys.oneTimeKeys(7) });
    const gateway = await connectGateway(server, erin);
    expect(gateway.ready.d).toMatchObject({ oneTimeKeyCount: 7, needsFallbackKey: true });
    gateway.close();
  });

  it("sends DEVICE_LIST_UPDATE to users who can see the user, and to no one else", async () => {
    const frank = await registerUser(server, "dlf");
    const friend = await registerUser(server, "dlr");
    const guildMate = await registerUser(server, "dlg");
    const stranger = await registerUser(server, "dls");
    await makeFriends(server, frank, friend);
    await shareGuild(server, guildMate, [frank]);
    const frankSecond = await loginNewDevice(server, frank);

    const clients = await Promise.all(
      [friend, guildMate, stranger, frankSecond].map((user) => connectGateway(server, user)),
    );
    const [friendWs, guildWs, strangerWs, ownWs] = clients;
    await new TestDeviceKeys(frank).upload(server);

    for (const client of [friendWs!, guildWs!, ownWs!]) {
      expect(await client.event("DEVICE_LIST_UPDATE", (d) => d.userId === frank.userId)).toEqual({ userId: frank.userId });
    }
    expect(await strangerWs!.never("DEVICE_LIST_UPDATE")).toBe(true);

    // One-time keys do not change the device list.
    friendWs!.drain();
    await apiFor(server, frank).post("/keys/upload", { oneTimeKeys: new TestDeviceKeys(frank).oneTimeKeys(0) });
    expect(await friendWs!.never("DEVICE_LIST_UPDATE")).toBe(true);

    // A sign-out of a device with keys does.
    await apiFor(server, frank).post("/auth/logout");
    expect(await friendWs!.event("DEVICE_LIST_UPDATE", (d) => d.userId === frank.userId)).toBeTruthy();
    for (const client of clients) {
      client.close();
    }
  });
});
