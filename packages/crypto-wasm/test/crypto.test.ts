import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  Account,
  GroupSession,
  InboundGroupSession,
  SigningKey,
  initSync,
  verify,
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

  it('verifies Ed25519 signatures and rejects bad input', () => {
    const account = new Account();
    const signature = account.sign('{"type":"device_keys"}');
    expect(verify(account.ed25519_key, '{"type":"device_keys"}', signature)).toBe(true);
    expect(verify(account.ed25519_key, '{"type":"other"}', signature)).toBe(false);
    expect(verify(new Account().ed25519_key, '{"type":"device_keys"}', signature)).toBe(false);
    expect(verify('garbage', '{"type":"device_keys"}', signature)).toBe(false);
    expect(verify(account.ed25519_key, '{"type":"device_keys"}', 'garbage')).toBe(false);
  });

  it('makes a fallback key that a different device can use after the one-time keys are gone', () => {
    const alice = new Account();
    const bob = new Account();
    expect(bob.max_number_of_one_time_keys).toBe(50);
    expect(bob.fallback_key()).toBe('{}');
    bob.generate_fallback_key();
    const fallback = Object.values(JSON.parse(bob.fallback_key()) as Record<string, string>)[0]!;
    bob.mark_keys_as_published();
    expect(bob.fallback_key()).toBe('{}');

    const out = alice.create_outbound_session(bob.curve25519_key, fallback);
    const first = out.encrypt(text.encode('one'));
    const result = bob.create_inbound_session(alice.curve25519_key, first.message_type, first.ciphertext);
    expect(read(result.plaintext)).toBe('one');
    const inbound = result.take_session();

    // The next pre-key message of the same session matches it. A message of a new session does not.
    const second = out.encrypt(text.encode('two'));
    expect(second.message_type).toBe(0);
    expect(inbound.session_matches(second.message_type, second.ciphertext)).toBe(true);
    const other = alice.create_outbound_session(bob.curve25519_key, fallback).encrypt(text.encode('x'));
    expect(inbound.session_matches(other.message_type, other.ciphertext)).toBe(false);
    expect(inbound.has_received_message).toBe(true);
    expect(out.has_received_message).toBe(false);
  });

  it('signs with a standalone signing key that survives a pickle', () => {
    const key = crypto.getRandomValues(new Uint8Array(32));
    const master = new SigningKey();
    const copy = SigningKey.from_pickle(master.pickle(key), key);
    expect(copy.public_key).toBe(master.public_key);
    expect(verify(master.public_key, 'device', copy.sign('device'))).toBe(true);
    expect(() => SigningKey.from_pickle(master.pickle(key), new Uint8Array(32))).toThrow();
    expect(() => master.pickle(new Uint8Array(3))).toThrow();
  });
});
