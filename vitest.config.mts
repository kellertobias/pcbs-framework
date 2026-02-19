import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["framework/tests/**/*.test.ts", "src/**/*.test.ts"],
    server: {
      deps: {
        external: ["opencascade.js"],
      },
    },
  },
});
