import { assertFalse, assertIdentical } from "@kensio/smartass";
import { describe, it } from "vitest";

import { exitCodes } from "./failure.js";

describe("the codes the CLI exits with", () => {
  it("is 0 for success, 1 for a failed command and 2 for a bad line", () => {
    // Given the numbers, which are the interface with whatever ran the
    // command. Written out here rather than read from the same object the
    // rest of the tests compare against, because a shell script branching on
    // 1 and 2 is the thing that breaks when they move.
    //
    // 2 for a usage error is the convention getopt set and argparse kept.
    assertIdentical(exitCodes.success, 0);
    assertIdentical(exitCodes.failure, 1);
    assertIdentical(exitCodes.usage, 2);
  });

  it("tells a command that failed apart from a command line that was wrong", () => {
    // Given the two failure codes.
    // Then they differ. A retry sometimes gets past the first and never past
    // the second, and a caller can only act on that if the two are told
    // apart.
    assertFalse(Object.is(exitCodes.failure, exitCodes.usage));
  });
});
