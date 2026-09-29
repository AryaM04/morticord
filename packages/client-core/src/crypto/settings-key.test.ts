// Tests of the settings key with the real vodozemac WASM and the fake
// server: the share to the own devices, the request of a new device, and
// the rule that only devices of the same user count.
import { beforeAll, describe, expect, it } from "vitest";
import { FakeServer, initWasmForTests, newClient, type TestClient } from "./test/fake-server.js";
import { SettingsKeyMissingError, SETTINGS_KEY_TYPE } from "./settings-key.js";

beforeAll(() => {
  initWasmForTests();
});

async function settle(...clients: TestClient[]): Promise<void> {
  for (let round = 0; round < 3; round += 1) {
    for (const client of clients) {
      await client.handle?.whenIdle();
    }
  }
}

const plaintext = new TextEncoder().encode(JSON.stringify({ playRingSound: false }));

describe("settings key", () => {
  it("shares a new key with the other devices of the user, and they decrypt the blob", async () => {
    const server = new FakeServer();
    const a1 = newClient("1", "A1");
    const a2 = newClient("1", "A2");
    const b1 = newClient("2", "B1");
    for (const client of [a1, a2, b1]) {
      await server.start(client);
    }
    const sealed = await a1.handle!.settings.seal(plaintext, null);
    await settle(a1, a2, b1);

    const opened = await a2.handle!.settings.open(sealed.blob);
    expect(opened.keyId).toBe(sealed.keyId);
    expect(opened.plaintext).toEqual(plaintext);
    // The key went only to the devices of the same user.
    expect(b1.received.some((entry) => entry.type === SETTINGS_KEY_TYPE)).toBe(false);
    await expect(b1.handle!.settings.open(sealed.blob)).rejects.toBeInstanceOf(SettingsKeyMissingError);

    // The same key id encrypts the next save.
    expect((await a1.handle!.settings.seal(plaintext, sealed.keyId)).keyId).toBe(sealed.keyId);
    // The key survives a restart, encrypted in the store.
    server.stop(a2);
    await server.start(a2);
    expect((await a2.handle!.settings.open(sealed.blob)).plaintext).toEqual(plaintext);
  });

  it("a new device asks for the key, gets it from an own device, and is told when it arrives", async () => {
    const server = new FakeServer();
    const a1 = newClient("1", "A1");
    await server.start(a1);
    const sealed = await a1.handle!.settings.seal(plaintext, null);

    const a3 = newClient("1", "A3");
    await server.start(a3);
    const arrived: string[] = [];
    a3.handle!.settings.onKey((keyId) => arrived.push(keyId));
    await expect(a3.handle!.settings.open(sealed.blob)).rejects.toBeInstanceOf(SettingsKeyMissingError);
    await expect.poll(async () => {
      await settle(a1, a3);
      return arrived;
    }).toEqual([sealed.keyId]);
    expect((await a3.handle!.settings.open(sealed.blob)).plaintext).toEqual(plaintext);
  });

  it("drops a settings key from a different user", async () => {
    const server = new FakeServer();
    const a1 = newClient("1", "A1");
    const b1 = newClient("2", "B1");
    await server.start(a1);
    await server.start(b1);
    const sealed = await b1.handle!.settings.seal(plaintext, null);
    // A malicious user sends its key to A, to make A use it.
    await b1.handle!.encryptToDevices([{ userId: "1", deviceId: "A1" }], SETTINGS_KEY_TYPE, { keyId: sealed.keyId, key: "A".repeat(43) });
    await settle(a1, b1);
    await expect(a1.handle!.settings.open(sealed.blob)).rejects.toBeInstanceOf(SettingsKeyMissingError);
  });
});
