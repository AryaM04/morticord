// Root Vitest config. It finds tests in every package.
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: ["packages/*", "apps/server", "apps/web", "apps/desktop-electron"],
  },
});
