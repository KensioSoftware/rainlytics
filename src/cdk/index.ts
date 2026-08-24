// CDK constructs for the Rainlytics pipeline, reached as
// `@kensio/rainlytics/cdk`.
//
// Kept behind a subpath of its own so that a browser bundle importing the
// beacon cannot reach `aws-cdk-lib` through the package root. `aws-cdk-lib`
// and `constructs` are optional peer dependencies, so installing Rainlytics
// for the beacon alone pulls neither of them in.

import { Stack, Token } from "aws-cdk-lib/core";
import type { Construct } from "constructs";

/**
 * Refuses to synthesise unless the stack `scope` belongs to is pinned to
 * `requiredRegion`.
 *
 * CDK stacks are environment-agnostic by default, which means they deploy to
 * whichever region the current profile happens to name. Some of what
 * Rainlytics creates only works in one region: CloudFront log delivery is
 * configured through the CloudWatch Logs API, and that API only accepts these
 * calls in us-east-1 however far away the bucket is.
 *
 * An environment-agnostic stack fails this too. A stack that has not been
 * given an account and a region cannot promise anything about where it lands.
 *
 * @throws {Error} when the stack is environment-agnostic, or pinned elsewhere.
 */
export function requireStackRegion(
  scope: Construct,
  requiredRegion: string,
): void {
  const stack = Stack.of(scope);

  if (Token.isUnresolved(stack.account) || Token.isUnresolved(stack.region)) {
    throw new Error(
      `Stack "${stack.stackName}" is environment-agnostic, but it has to be` +
        ` given an explicit env with an account and the "${requiredRegion}"` +
        ` region.`,
    );
  }

  if (stack.region !== requiredRegion) {
    throw new Error(
      `Stack "${stack.stackName}" can only be deployed to` +
        ` "${requiredRegion}", but it is configured for "${stack.region}".`,
    );
  }
}

export {
  defaultLogRetention,
  LogBucket,
  type LogBucketProps,
} from "./log-bucket.js";
