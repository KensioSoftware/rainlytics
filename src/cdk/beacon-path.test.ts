import {
  assertIdentical,
  assertObjectEquals,
  assertResponseStatus,
  assertStringIncludes,
  assertStringMatches,
  assertThrowsErrorAsync,
  describeResponse,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { SimAwsHttp } from "@kensio/yulin/serve";
import {
  CachePolicy,
  Distribution,
  ViewerProtocolPolicy,
} from "aws-cdk-lib/aws-cloudfront";
import { S3BucketOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { PolicyStatement, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { type App, CfnOutput, RemovalPolicy, Stack } from "aws-cdk-lib/core";
import { describe, it } from "vitest";

import { deployStacks } from "#test/simulated-deployment.js";

import { beaconQueryString, defaultBeaconPath } from "../beacon-events.js";
import { BeaconPath, type BeaconPathProps } from "./beacon-path.js";

describe("answering the beacon's collection path", () => {
  /**
   * A site's distribution with the beacon path added, deployed into a
   * simulated account and reachable over HTTP.
   *
   * The origin is a bucket holding one object at the site's root. That is
   * what makes "the origin was never asked" observable: a request the
   * function did not answer reaches an empty key and comes back as an S3
   * refusal rather than a 204.
   */
  const deployBeacon = async (props: Partial<BeaconPathProps> = {}) => {
    const { simAws, stacks } = await deployStacks(
      (app: App, account: string) => {
        const stack = new Stack(app, "SiteStack", {
          env: { account, region: "eu-west-2" },
        });

        const bucketName = `site-${faker.string.uuid()}`;
        const site = new Bucket(stack, "SiteBucket", {
          bucketName,
          removalPolicy: RemovalPolicy.DESTROY,
        });
        // The read grant CloudFront serves the site under. It is written by
        // hand because the origin below imports the bucket, and a grant on an
        // imported bucket is a policy nobody applies.
        site.addToResourcePolicy(
          new PolicyStatement({
            principals: [new ServicePrincipal("cloudfront.amazonaws.com")],
            actions: ["s3:GetObject"],
            resources: [site.arnForObjects("*")],
          }),
        );
        // Imported by name, because CDK's own `Bucket` is not assignable to
        // `IBucket` under `exactOptionalPropertyTypes`. That is the same
        // mismatch `LogDeliveryBucket` was shaped around.
        const origin = S3BucketOrigin.withOriginAccessControl(
          Bucket.fromBucketName(stack, "SiteOrigin", bucketName),
        );

        const distribution = new Distribution(stack, "SiteDistribution", {
          defaultBehavior: { origin },
        });
        new CfnOutput(stack, "DistributionDomainName", {
          value: distribution.distributionDomainName,
        });
        new CfnOutput(stack, "DistributionId", {
          value: distribution.distributionId,
        });
        new CfnOutput(stack, "SiteBucketName", { value: bucketName });

        new BeaconPath(stack, "RainlyticsBeacon", {
          ...props,
          distribution: props.distribution ?? distribution,
          origin: props.origin ?? origin,
        });
      },
    );

    const stack = stacks.get("SiteStack");
    const host = stack?.output("DistributionDomainName") ?? "";
    const bucketName = stack?.output("SiteBucketName") ?? "";
    const http = new SimAwsHttp({ simAws });

    return {
      simAws,
      bucketName,
      distributionId: stack?.output("DistributionId") ?? "",
      get: async (pathAndQuery: string): Promise<Response> =>
        http.fetch(`https://${host}${pathAndQuery}`, { redirect: "manual" }),
    };
  };

  it("answers the beacon path with 204 and no body", async () => {
    // Given a site with the beacon path deployed on its distribution.
    const { get } = await deployBeacon();

    // When the browser reports an event.
    const query = beaconQueryString({ event: "route", page: "/liju/" });
    const response = await get(`${defaultBeaconPath}?${query}`);

    // Then CloudFront answers 204 with nothing in it. The event is the log
    // record the request produced, and a body would be bytes charged for on
    // every event for a browser that reads none of them.
    assertResponseStatus(response, 204, await describeResponse(response));
    assertIdentical(await response.text(), "");
  });

  it("answers without asking the origin", async () => {
    // Given a site whose origin bucket holds nothing at the beacon path.
    const { get } = await deployBeacon();

    // When an event arrives.
    const response = await get(
      `${defaultBeaconPath}?${beaconQueryString({
        event: "vital",
        page: "/",
      })}`,
    );

    // Then it is answered at the edge. A request that reached the bucket
    // would come back as an S3 refusal, and a flood of them would be
    // arriving at the site itself rather than stopping at CloudFront.
    assertResponseStatus(response, 204, await describeResponse(response));
  });

  it("tells a browser to keep no copy of the answer", async () => {
    // Given the beacon path.
    const { get } = await deployBeacon();

    // When the same event is reported twice from the same page, which is the
    // same URL twice.
    const url = `${defaultBeaconPath}?${beaconQueryString({
      event: "click",
      page: "/grammar/",
    })}`;
    const first = await get(url);
    const second = await get(url);

    // Then neither answer is one a browser may store. A cached 204 would be
    // served out of the browser's own cache and that event would reach no
    // log.
    assertIdentical(first.headers.get("cache-control"), "no-store");
    assertResponseStatus(second, 204, await describeResponse(second));
  });

  it("leaves the rest of the site to the origin", async () => {
    // Given a site with a page at its root.
    const { simAws, bucketName, get } = await deployBeacon();
    await simAws
      .region("eu-west-2")
      .account()
      .s3()
      .putObject({
        input: { Bucket: bucketName, Key: "index.html", Body: "<h1>Liju</h1>" },
      });

    // When a reader asks for that page.
    const response = await get("/index.html");

    // Then the origin serves it. The behaviour covers one path and the
    // distribution carries on doing what it did before the beacon arrived.
    assertResponseStatus(response, 200, await describeResponse(response));
    assertStringIncludes(await response.text(), "Liju");
  });

  it("serves the path it is given", async () => {
    // Given a site whose router already answers `/_rainlytics`.
    const path = "/_collect";

    // When the beacon is pointed somewhere else.
    const { get } = await deployBeacon({ path });

    // Then that path is the one answered.
    const response = await get(
      `${path}?${beaconQueryString({ event: "route", page: "/" })}`,
    );
    assertResponseStatus(response, 204, await describeResponse(response));
  });

  it("refuses a path CloudFront would never match", async () => {
    // Given a path written without its leading slash, which CloudFront takes
    // as a valid pattern.
    const deploying = deployBeacon({ path: "_rainlytics" });

    // Then synthesis fails, naming the path. Deployed, it would match no
    // request the beacon sends, and the first sign of that is a dataset with
    // no beacon rows in it.
    {
      const error = await assertThrowsErrorAsync(() => deploying);
      assertStringMatches(error.message, /_rainlytics/u);
    }
    {
      const error = await assertThrowsErrorAsync(() => deploying);
      assertStringMatches(error.message, /leading slash/u);
    }
  });

  it("refuses a path carrying a query string", async () => {
    // Given a path with the payload already stuck on it.
    const deploying = deployBeacon({ path: "/_rainlytics?v=1" });

    // Then synthesis fails. A path pattern is matched against the path
    // alone, and the query string is where every event differs.
    {
      const error = await assertThrowsErrorAsync(() => deploying);
      assertStringMatches(error.message, /query string/u);
    }
  });

  describe("what the distribution is given", () => {
    /** The managed `CachingOptimized` policy, under the fixed id AWS gives it. */
    const cachingOptimized = "658327ea-f89d-4fab-a63d-7e88639e58f6";

    /** The beacon's own behaviour, read off the deployed distribution. */
    const beaconBehaviour = async (props: Partial<BeaconPathProps> = {}) => {
      const { simAws, distributionId } = await deployBeacon(props);
      const read = await simAws
        .cloudFront()
        .getDistribution({ input: { Id: distributionId } });

      return read.Distribution?.DistributionConfig?.CacheBehaviors?.Items?.find(
        (behaviour) =>
          behaviour.PathPattern === (props.path ?? defaultBeaconPath),
      );
    };

    /** The one function the deployed account holds, live. */
    const publishedFunction = async (props: Partial<BeaconPathProps> = {}) => {
      const { simAws } = await deployBeacon(props);
      const listed = await simAws
        .cloudFront()
        .listFunctions({ input: { Stage: "LIVE" } });

      return listed.FunctionList.Items[0];
    };

    it("leaves the query string out of the cache key", async () => {
      // Given a beacon path taking the default cache policy.
      // When the stack is deployed.
      const behaviour = await beaconBehaviour();

      // Then the behaviour carries the managed policy that keys on the path
      // alone. The payload travels in the query string, and a policy keying
      // on it would make every event a cache entry of its own.
      assertIdentical(behaviour?.CachePolicyId, cachingOptimized);
    });

    it("takes a cache policy a site would rather use", async () => {
      // Given a site standardising on one managed policy across its
      // behaviours, this one keying on nothing and storing nothing.
      const cachePolicy = CachePolicy.CACHING_DISABLED;

      // When the beacon is deployed with it.
      const behaviour = await beaconBehaviour({ cachePolicy });

      // Then that is the policy on the behaviour.
      assertIdentical(behaviour?.CachePolicyId, cachePolicy.cachePolicyId);
    });

    it("refuses plain HTTP by default", async () => {
      // Given a beacon path taking its default viewer protocol policy.
      // When the stack is deployed.
      const behaviour = await beaconBehaviour();

      // Then the behaviour is HTTPS-only. CloudFront answers an HTTP request
      // with 403, so a keepalive send never depends on a redirected second
      // request surviving the page that started it.
      assertIdentical(behaviour?.ViewerProtocolPolicy, "https-only");
    });

    it("takes a viewer protocol policy a site would rather use", async () => {
      // Given a site that still admits HTTP and wants CloudFront to redirect
      // the collection path with the rest of it.
      const viewerProtocolPolicy = ViewerProtocolPolicy.REDIRECT_TO_HTTPS;

      // When the beacon is deployed with that policy.
      const behaviour = await beaconBehaviour({ viewerProtocolPolicy });

      // Then the deployed behaviour carries the site's choice.
      assertIdentical(behaviour?.ViewerProtocolPolicy, "redirect-to-https");
    });

    it("runs the function before the cache is consulted", async () => {
      // Given the same stack.
      const behaviour = await beaconBehaviour();

      // Then the function is associated at viewer-request. CloudFront
      // reaches that event before the cache lookup and before any origin
      // request, and it is what makes the 204 free of both.
      assertObjectEquals(
        behaviour?.FunctionAssociations?.Items?.map(
          (association) => association.EventType,
        ),
        ["viewer-request"],
      );
    });

    it("deploys the function on the JS 2.0 runtime", async () => {
      // Given the same stack.
      const summary = await publishedFunction();

      // Then the function names the runtime its source is written against.
      // The lint rules on `beacon-204.cff.js` hold it to JS 2.0's
      // restrictions, and JS 1.0 has its own.
      assertIdentical(summary?.FunctionConfig.Runtime, "cloudfront-js-2.0");
    });

    it("takes a function name where the account needs a chosen one", async () => {
      // Given two sites in one account. CloudFront function names are unique
      // across an account, and CDK derives one from the construct's path in
      // the tree.
      const functionName = `beacon-${faker.string.alphanumeric(8)}`;

      // When the beacon is deployed under a name of its own.
      const summary = await publishedFunction({ functionName });

      // Then that is the name it carries.
      assertIdentical(summary?.Name, functionName);
    });
  });
});
