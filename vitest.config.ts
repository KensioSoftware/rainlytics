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
    /*
     * Longer than the 5 second default, because a construct case deploys a
     * synthesised cloud assembly into a simulated account rather than calling
     * a function. That takes a few hundred milliseconds here and rather more
     * on a loaded CI runner, and the default was tight enough that a job
     * failed on timing while the same commit passed locally and on the other
     * Node in the matrix.
     */
    testTimeout: 20_000,
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
      /*
       * The CLI's entry point is process wiring and nothing else. Covering it
       * here would mean a test that replaces `process.argv`, `process.stdout`
       * and `process.exitCode`, and what it would then prove is that the
       * replacements were wired up. `scripts/sh/pack-check.sh` runs the real
       * file out of the packed tarball instead, which also proves the parts
       * a unit test cannot reach: the shebang, the `bin` entry, and that it
       * runs with no dependencies installed beside it.
       */
      exclude: ["src/cli/bin.ts"],
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
