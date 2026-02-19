import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    include: ["framework/tests/**/*.test.ts", "src/**/*.test.ts"],
    // Polyfill __dirname and __filename for Emscripten glue code in ESM mode
    define: {
      "__dirname": "import.meta.url.replace('file://', '').replace(/\\/[^\\/]*$/, '')",
      "__filename": "import.meta.url.replace('file://', '')",
    }
  },
});
