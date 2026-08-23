import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "#test": fileURLToPath(new URL("./test", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    // Tests live beside the code they test. `test/` is for fixtures and
    // helpers, which is what the `#test` alias above and the `imports` entry in
    // package.json address.
    include: ["src/**/*.test.ts"],
    typecheck: {
      tsconfig: "./tsconfig.json",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      reporter: ["text", "lcov", "json-summary"],
      reportsDirectory: "./test/.coverage",
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
    restoreMocks: true,
    // The two halves of undoing a test's mocks, and they cover different
    // things: `restoreMocks` puts back what `vi.spyOn` replaced, while a global
    // replaced by `vi.stubGlobal` is only put back by `vi.unstubAllGlobals`,
    // which this option is what schedules.
    unstubGlobals: true,
  },
});
