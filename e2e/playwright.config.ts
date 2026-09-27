// Playwright config for the WebRTC-over-TURN relay test.
//
// This test needs a real Chromium engine (fake media devices, ICE and
// getStats), so it runs on Chromium only, not on other engines.
import { defineConfig, devices } from "@playwright/test";

const FIXTURE_PORT = 4310;

export default defineConfig({
  testDir: "./tests",
  timeout: 40_000,
  fullyParallel: false,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${FIXTURE_PORT}`,
  },
  webServer: {
    command: `node fixtures/server.mjs`,
    url: `http://localhost:${FIXTURE_PORT}`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(FIXTURE_PORT) },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: {
          args: [
            "--use-fake-device-for-media-stream",
            "--use-fake-ui-for-media-stream",
          ],
        },
      },
    },
  ],
});
