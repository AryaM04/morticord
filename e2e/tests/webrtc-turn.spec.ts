// Spike test: prove that two browser peers can connect over WebRTC
// through the local coturn relay only, with no direct or STUN path.
//
// The test forces this with iceTransportPolicy: "relay", so the only
// candidate pair that can work is a "relay" pair through coturn.
import { createConnection } from "node:net";
import { expect, test } from "@playwright/test";
import { createTurnCredentials } from "../../apps/server/src/turn.ts";
import { loadRootEnv } from "../env.js";

loadRootEnv();

// Chromium on Linux does not send ICE traffic through the loopback
// interface. On Linux, set TURN_TEST_HOST to the host IP address.
const TURN_HOST = process.env.TURN_TEST_HOST ?? "127.0.0.1";
const TURN_PORT = Number(process.env.TURN_PORT ?? "3478");
const TURN_SECRET = process.env.TURN_SECRET ?? "";
const CANDIDATE_RELAY_TIMEOUT_MS = 20_000;
const BYTES_GROWTH_WINDOW_MS = 2_000;

/** Check whether a TCP connect to host:port succeeds within timeoutMs. */
function isPortOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    const finish = (result: boolean) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      finish(true);
    });
    socket.once("error", () => {
      clearTimeout(timer);
      finish(false);
    });
  });
}

test("two peers connect over WebRTC through the TURN relay only", async ({ browser }) => {
  test.skip(
    TURN_SECRET === "",
    "TURN_SECRET is not set. Copy .env.example to .env, then set it there.",
  );

  const coturnUp = await isPortOpen(TURN_HOST, TURN_PORT, 1500);
  // A CI job that starts coturn sets TURN_TEST_REQUIRED, so that the test fails instead of a skip.
  if (process.env.TURN_TEST_REQUIRED === "true") {
    expect(coturnUp, `coturn is not reachable at ${TURN_HOST}:${TURN_PORT}.`).toBe(true);
  }
  test.skip(
    !coturnUp,
    `coturn is not reachable at ${TURN_HOST}:${TURN_PORT}. Start it first: ` +
      "docker compose --env-file .env -f infra/docker-compose.dev.yml up -d coturn",
  );

  const contextA = await browser.newContext();
  const contextB = await browser.newContext();
  const pageA = await contextA.newPage();
  const pageB = await contextB.newPage();

  await pageA.goto("/");
  await pageB.goto("/");

  const credsA = createTurnCredentials(TURN_SECRET, "peer-a", 60);
  const credsB = createTurnCredentials(TURN_SECRET, "peer-b", 60);
  const turnUrl = `turn:${TURN_HOST}:${TURN_PORT}?transport=udp`;

  await pageA.evaluate(
    ({ url, username, credential }) =>
      window.createPeer([{ urls: url, username, credential }]),
    { url: turnUrl, username: credsA.username, credential: credsA.credential },
  );
  await pageB.evaluate(
    ({ url, username, credential }) =>
      window.createPeer([{ urls: url, username, credential }]),
    { url: turnUrl, username: credsB.username, credential: credsB.credential },
  );

  await pageA.evaluate(() => window.addMicTrack());
  await pageB.evaluate(() => window.addRecvOnlyAudio());

  const offer = await pageA.evaluate(() => window.createOffer());
  const answer = await pageB.evaluate((o) => window.createAnswer(o), offer);
  await pageA.evaluate((a) => window.acceptAnswer(a), answer);

  // Relay ICE candidates both ways by hand, since there is no signaling
  // server here. Keep going until both peers reach "connected", or the
  // test runs out of time.
  const deadline = Date.now() + CANDIDATE_RELAY_TIMEOUT_MS;
  let stateA = "";
  let stateB = "";
  while (Date.now() < deadline) {
    const candsA = await pageA.evaluate(() => window.drainCandidates());
    for (const candidate of candsA) {
      await pageB.evaluate((c) => window.addRemoteCandidate(c), candidate);
    }
    const candsB = await pageB.evaluate(() => window.drainCandidates());
    for (const candidate of candsB) {
      await pageA.evaluate((c) => window.addRemoteCandidate(c), candidate);
    }

    stateA = await pageA.evaluate(() => window.getConnectionState());
    stateB = await pageB.evaluate(() => window.getConnectionState());
    if (stateA === "connected" && stateB === "connected") {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  if (stateA !== "connected" || stateB !== "connected") {
    // Show the ICE events. They tell why the relay did not work.
    console.log("TURN server:", turnUrl);
    console.log("Peer A ICE log:", await pageA.evaluate(() => window.iceLog));
    console.log("Peer B ICE log:", await pageB.evaluate(() => window.iceLog));
  }
  expect(stateA).toBe("connected");
  expect(stateB).toBe("connected");

  const candidateTypeA = await pageA.evaluate(() => window.getSelectedCandidateType());
  const candidateTypeB = await pageB.evaluate(() => window.getSelectedCandidateType());
  expect(candidateTypeA).toBe("relay");
  expect(candidateTypeB).toBe("relay");

  const bytesStart = await pageB.evaluate(() => window.getInboundBytesReceived());
  await new Promise((resolve) => setTimeout(resolve, BYTES_GROWTH_WINDOW_MS));
  const bytesEnd = await pageB.evaluate(() => window.getInboundBytesReceived());
  expect(bytesEnd).toBeGreaterThan(bytesStart);

  await contextA.close();
  await contextB.close();
});
