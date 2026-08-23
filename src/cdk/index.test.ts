import { faker } from "@faker-js/faker";
import { App, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { requireStackRegion } from "./index.js";

describe("requiring a stack region", () => {
  const anAccount = (): string =>
    faker.string.numeric({ length: 12, allowLeadingZeros: false });

  it("accepts a stack pinned to the region it asks for", () => {
    // Given a stack given an explicit env in the region being required.
    const region = faker.helpers.arrayElement(["us-east-1", "eu-west-2"]);
    const stack = new Stack(new App(), "PinnedStack", {
      env: { account: anAccount(), region },
    });

    // When that region is required of it.
    const requiring = (): void => {
      requireStackRegion(stack, region);
    };

    // Then it synthesises.
    expect(requiring).not.toThrow();
  });

  it("refuses a stack pinned to a different region, naming both", () => {
    // Given a stack deployed somewhere the log delivery API cannot be called.
    const stack = new Stack(new App(), "SiteStack", {
      env: { account: anAccount(), region: "eu-west-2" },
    });

    // When us-east-1 is required of it.
    const requiring = (): void => {
      requireStackRegion(stack, "us-east-1");
    };

    // Then it says which stack, and which region it actually has, because a
    // message carrying neither leaves the reader to find the stack itself.
    expect(requiring).toThrow(/SiteStack/u);
    expect(requiring).toThrow(/eu-west-2/u);
    expect(requiring).toThrow(/us-east-1/u);
  });

  it("refuses an environment-agnostic stack", () => {
    // Given a stack with no env, which lands wherever the profile points.
    const stack = new Stack(new App(), "AgnosticStack");

    // When a region is required of it.
    const requiring = (): void => {
      requireStackRegion(stack, "us-east-1");
    };

    // Then it is refused. A stack that has not been told where it goes cannot
    // promise to be anywhere, so this is a different failure from being
    // pinned to the wrong place, and the message says so.
    expect(requiring).toThrow(/environment-agnostic/u);
  });

  it("finds the stack from a construct inside it", () => {
    // Given a construct nested somewhere below the stack, which is how the
    // constructs that call this will actually reach it.
    const stack = new Stack(new App(), "SiteStack", {
      env: { account: anAccount(), region: "eu-west-2" },
    });
    const nested = new Stack(stack, "NestedScope", {
      env: { account: anAccount(), region: "eu-west-2" },
    });

    // When a region is required of the nested scope.
    const requiring = (): void => {
      requireStackRegion(nested, "us-east-1");
    };

    // Then the nested stack is the one reported.
    expect(requiring).toThrow(/NestedScope/u);
  });
});
