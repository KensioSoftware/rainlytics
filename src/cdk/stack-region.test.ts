import { faker } from "@faker-js/faker";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { App, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import { requireStackRegion } from "./stack-region.js";

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

describe("deploying the two regions Rainlytics needs", () => {
  it("puts each stack in the region its own environment names", async () => {
    // Given the shape a consumer ends up with: their site and its log bucket
    // wherever they keep them, and a second stack in us-east-1, which is the
    // only region the log delivery API accepts these calls in.
    const logBucketName = `rainlytics-logs-${faker.string.uuid()}`;
    const resultsBucketName = `rainlytics-results-${faker.string.uuid()}`;

    // When both stacks are deployed together, as one cloud assembly.
    const { simAws, stacks } = await deployStacks((app, account) => {
      const site = new Stack(app, "SiteStack", {
        env: { account, region: "eu-west-2" },
      });
      new Bucket(site, "LogBucket", { bucketName: logBucketName });

      const delivery = new Stack(app, "DeliveryStack", {
        env: { account, region: "us-east-1" },
      });
      requireStackRegion(delivery, "us-east-1");
      // CloudFormation refuses a template carrying no resources, and the
      // region check creates none, so the stack needs something in it to be
      // deployable at all. The log delivery resources take this place in #8.
      new Bucket(delivery, "ResultsBucket", { bucketName: resultsBucketName });
    });

    // Then both went up.
    expect([...stacks.keys()]).toStrictEqual(
      expect.arrayContaining(["SiteStack", "DeliveryStack"]),
    );

    // And the bucket is in the site's region rather than the delivery one,
    // which is the split the delivery construct will have to work across.
    const inSiteRegion = await simAws
      .region("eu-west-2")
      .s3()
      .listBuckets({ input: {} });
    expect(inSiteRegion.Buckets?.map((bucket) => bucket.Name)).toContain(
      logBucketName,
    );

    const inDeliveryRegion = await simAws
      .region("us-east-1")
      .s3()
      .listBuckets({ input: {} });
    const deliveryRegionBuckets = inDeliveryRegion.Buckets?.map(
      (bucket) => bucket.Name,
    );
    expect(deliveryRegionBuckets).not.toContain(logBucketName);
    expect(deliveryRegionBuckets).toContain(resultsBucketName);
  });

  it("refuses a delivery stack put in the site's region", async () => {
    // Given the delivery stack placed beside everything else, which is the
    // easy mistake, since that is where the rest of a consumer's app lives.
    // When the app is synthesised.
    const deploying = deployStacks((app, account) => {
      const delivery = new Stack(app, "DeliveryStack", {
        env: { account, region: "eu-west-2" },
      });
      requireStackRegion(delivery, "us-east-1");
    });

    // Then it fails on the way through synthesis, before anything deploys.
    // The unit cases above build a Stack by hand, and this one proves the
    // check still fires where a construct will actually sit.
    await expect(deploying).rejects.toThrow(/us-east-1/u);
  });
});
