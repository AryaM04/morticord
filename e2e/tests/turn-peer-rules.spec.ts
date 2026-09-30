// Check the peer address rules of the production coturn config
// (infra/coturn/turnserver.prod.conf). A small TURN client makes an
// allocation, then asks for a permission to each peer address. coturn must
// refuse the private addresses with error 403, so that nobody can use the
// relay to reach the home network. A public address is the control case.
//
// The test runs only when TURN_EXPECT_PROD_RULES=true. The development
// config allows private peers, so the test cannot pass against it.
import { createHash, createHmac, randomBytes } from "node:crypto";
import { createSocket, type Socket } from "node:dgram";
import { isIPv4 } from "node:net";
import { expect, test } from "@playwright/test";
import { createTurnCredentials } from "../../apps/server/src/turn.ts";
import { loadRootEnv } from "../env.js";

loadRootEnv();

const TURN_HOST = process.env.TURN_TEST_HOST ?? "127.0.0.1";
const TURN_PORT = Number(process.env.TURN_PORT ?? "3478");
const TURN_SECRET = process.env.TURN_SECRET ?? "";
const EXPECT_PROD_RULES = process.env.TURN_EXPECT_PROD_RULES === "true";

const MAGIC_COOKIE = 0x2112a442;
const ALLOCATE = 0x0003;
const CREATE_PERMISSION = 0x0008;
const ATTRIBUTE = {
  USERNAME: 0x0006,
  MESSAGE_INTEGRITY: 0x0008,
  ERROR_CODE: 0x0009,
  XOR_PEER_ADDRESS: 0x0012,
  XOR_RELAYED_ADDRESS: 0x0016,
  REALM: 0x0014,
  NONCE: 0x0015,
  REQUESTED_TRANSPORT: 0x0019,
};
const UDP_TRANSPORT = Buffer.from([17, 0, 0, 0]);

interface StunResponse {
  /** The class bits of the message type: 0x0100 is success, 0x0110 is error. */
  success: boolean;
  errorCode?: number;
  attributes: Map<number, Buffer>;
}

function attribute(type: number, value: Buffer): Buffer {
  const header = Buffer.alloc(4);
  header.writeUInt16BE(type, 0);
  header.writeUInt16BE(value.length, 2);
  const padding = Buffer.alloc((4 - (value.length % 4)) % 4);
  return Buffer.concat([header, value, padding]);
}

function xorPeerAddress(ip: string, port: number): Buffer {
  const value = Buffer.alloc(8);
  value.writeUInt8(0x01, 1); // IPv4
  value.writeUInt16BE(port ^ (MAGIC_COOKIE >>> 16), 2);
  const address = ip.split(".").reduce((sum, part) => sum * 256 + Number(part), 0);
  value.writeUInt32BE((address ^ MAGIC_COOKIE) >>> 0, 4);
  return value;
}

/** Build a STUN request. With `key`, add MESSAGE-INTEGRITY (RFC 5389 section 15.4). */
function buildRequest(method: number, attributes: Buffer[], key?: Buffer): Buffer {
  const body = Buffer.concat(attributes);
  const header = Buffer.alloc(20);
  header.writeUInt16BE(method, 0);
  header.writeUInt32BE(MAGIC_COOKIE, 4);
  randomBytes(12).copy(header, 8);
  if (!key) {
    header.writeUInt16BE(body.length, 2);
    return Buffer.concat([header, body]);
  }
  // The length includes the MESSAGE-INTEGRITY attribute (4 + 20 bytes).
  header.writeUInt16BE(body.length + 24, 2);
  const digest = createHmac("sha1", key).update(Buffer.concat([header, body])).digest();
  return Buffer.concat([header, body, attribute(ATTRIBUTE.MESSAGE_INTEGRITY, digest)]);
}

function parseResponse(message: Buffer): StunResponse {
  const type = message.readUInt16BE(0);
  const attributes = new Map<number, Buffer>();
  let offset = 20;
  while (offset + 4 <= message.length) {
    const attributeType = message.readUInt16BE(offset);
    const length = message.readUInt16BE(offset + 2);
    attributes.set(attributeType, message.subarray(offset + 4, offset + 4 + length));
    offset += 4 + length + ((4 - (length % 4)) % 4);
  }
  const error = attributes.get(ATTRIBUTE.ERROR_CODE);
  return {
    success: (type & 0x0110) === 0x0100,
    errorCode: error ? (error.readUInt8(2) & 0x07) * 100 + error.readUInt8(3) : undefined,
    attributes,
  };
}

function exchange(socket: Socket, request: Buffer): Promise<StunResponse> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("coturn did not answer in 3 seconds.")), 3000);
    socket.once("message", (message) => {
      clearTimeout(timer);
      resolve(parseResponse(message));
    });
    socket.send(request, TURN_PORT, TURN_HOST);
  });
}

test("the production TURN config refuses private peer addresses", async () => {
  test.skip(!EXPECT_PROD_RULES, "Set TURN_EXPECT_PROD_RULES=true to test the production coturn config.");
  expect(TURN_SECRET, "TURN_SECRET is not set.").not.toBe("");
  expect(isIPv4(TURN_HOST)).toBe(true);

  const { username, credential } = createTurnCredentials(TURN_SECRET, "peer-rules", 60);
  const socket = createSocket("udp4");
  try {
    // The first Allocate has no credentials. coturn answers 401 with the realm and a nonce.
    const challenge = await exchange(socket, buildRequest(ALLOCATE, [attribute(ATTRIBUTE.REQUESTED_TRANSPORT, UDP_TRANSPORT)]));
    expect(challenge.errorCode).toBe(401);
    const realm = challenge.attributes.get(ATTRIBUTE.REALM)!;
    const nonce = challenge.attributes.get(ATTRIBUTE.NONCE)!;
    const key = createHash("md5").update(`${username}:${realm.toString()}:${credential}`).digest();
    const auth = [
      attribute(ATTRIBUTE.USERNAME, Buffer.from(username)),
      attribute(ATTRIBUTE.REALM, realm),
      attribute(ATTRIBUTE.NONCE, nonce),
    ];

    const allocation = await exchange(
      socket,
      buildRequest(ALLOCATE, [attribute(ATTRIBUTE.REQUESTED_TRANSPORT, UDP_TRANSPORT), ...auth], key),
    );
    expect(allocation.success, `Allocate failed with error ${allocation.errorCode}`).toBe(true);

    const permission = (peer: string) =>
      exchange(socket, buildRequest(CREATE_PERMISSION, [attribute(ATTRIBUTE.XOR_PEER_ADDRESS, xorPeerAddress(peer, 9)), ...auth], key));

    // Two peers that both use the relay send to the relay address of the
    // other peer. This address is on the TURN host, so start.sh allows it.
    const relayed = allocation.attributes.get(ATTRIBUTE.XOR_RELAYED_ADDRESS)!;
    const relayIp = [4, 5, 6, 7].map((i) => relayed.readUInt8(i) ^ ((MAGIC_COOKIE >>> (8 * (7 - i))) & 0xff)).join(".");
    const toRelay = await permission(relayIp);
    expect(toRelay.success, `CreatePermission for the relay address ${relayIp} failed with error ${toRelay.errorCode}`).toBe(true);

    const privatePeers = ["127.0.0.1", "10.0.0.1", "172.16.0.1", "192.168.1.1", "169.254.169.254", "100.64.0.1"];
    for (const peer of privatePeers.filter((address) => address !== relayIp && address !== TURN_HOST)) {
      const result = await permission(peer);
      expect(result.success, `coturn allowed the private peer ${peer}`).toBe(false);
      expect(result.errorCode, `the answer for ${peer}`).toBe(403);
    }

    // The control case: a public address. Without it, a broken client could make the test pass.
    const allowed = await permission("8.8.8.8");
    expect(allowed.success, `CreatePermission for a public peer failed with error ${allowed.errorCode}`).toBe(true);
  } finally {
    socket.close();
  }
});
