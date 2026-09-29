// End-to-end test of a second tab of the same device: only one tab runs
// the crypto layer. The second tab shows a banner, and it takes over the
// encryption when the first tab closes.
//
// Needs a real Postgres (see auth.spec.ts): skips itself when it is not
// reachable.
import { expect, test } from "@playwright/test";
import { waitForCrypto } from "../lib/crypto-debug.js";

const WEB_ORIGIN = "http://localhost:5173";

test.skip(
  process.env.E2E_AUTH_AVAILABLE !== "true",
  "Postgres is not reachable. Start it with docker compose (see playwright.config.ts).",
);

test("a second tab shows the banner, and takes over when the first tab closes", async ({ browser, request }) => {
  test.setTimeout(60_000);
  const stamp = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
  const user = {
    email: `e2e-tab-${stamp}@example.test`,
    username: `tab${stamp}`.slice(0, 32),
    password: "correct-horse-battery-staple",
  };
  const response = await request.post(`${WEB_ORIGIN}/api/v1/auth/register`, { data: user });
  expect(response.ok()).toBe(true);

  const context = await browser.newContext();
  const first = await context.newPage();
  await first.goto(`${WEB_ORIGIN}/login`);
  await first.getByLabel("Email").fill(user.email);
  await first.getByLabel("Password").fill(user.password);
  await first.getByRole("button", { name: "Sign in" }).click();
  await expect(first).toHaveURL(/\/app(\/|$)/);
  await waitForCrypto(first);

  const second = await context.newPage();
  await second.goto(`${WEB_ORIGIN}/app`);
  const banner = second.getByText("Encryption runs in another tab of this app. Use that tab, or close it.");
  await expect(banner).toBeVisible({ timeout: 15_000 });
  await expect(first.locator("[data-crypto-other-tab]")).toHaveCount(0);

  await first.close();
  await expect(banner).toBeHidden({ timeout: 15_000 });
  await waitForCrypto(second);
  await context.close();
});
