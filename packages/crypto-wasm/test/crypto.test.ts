import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Account,
  GroupSession,
  InboundGroupSession,
  initSync,
} from '../pkg/crypto_wasm.js';

const text = new TextEncoder();
const read = (b: Uint8Array) => new TextDecoder().decode(b);

beforeAll(() => {
  initSync({ module: readFileSync(new URL('../pkg/crypto_wasm_bg.wasm', import.meta.url)) });
});

describe('crypto-wasm', () => {
  it('sends an Olm message from one device to a different device', () => {
    const alice = new Account();
    const bob = new Account();
    bob.generate_one_time_keys(1);
    const otk = Object.values(JSON.parse(bob.one_time_keys()) as Record<string, string>)[0];

    const out = alice.create_outbound_session(bob.curve25519_key, otk);
    const msg = out.encrypt(text.encode('hello'));
    const result = bob.create_inbound_session(alice.curve25519_key, msg.message_type, msg.ciphertext);
    expect(read(result.plaintext)).toBe('hello');

    const bobSession = result.take_session();
    const reply = bobSession.encrypt(text.encode('hi'));
    expect(read(out.decrypt(reply.message_type, reply.ciphertext))).toBe('hi');
  });

  it('lets a late member read old Megolm messages with an exported key', () => {
    const group = new GroupSession();
    const inbound = new InboundGroupSession(group.session_key);
    const old = group.encrypt(text.encode('old message'));
    expect(read(inbound.decrypt(old).plaintext)).toBe('old message');

    const late = InboundGroupSession.import(inbound.export_at(0)!);
    expect(read(late.decrypt(old).plaintext)).toBe('old message');
  });

  it('keeps state after pickle and unpickle', () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const account = new Account();
    const copy = Account.from_pickle(account.pickle(key), key);
    expect(copy.curve25519_key).toBe(account.curve25519_key);
    expect(() => Account.from_pickle(account.pickle(key), new Uint8Array(32))).toThrow();
  });
});
