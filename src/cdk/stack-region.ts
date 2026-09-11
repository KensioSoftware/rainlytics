// Where a construct insists on the region it is deployed to.

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
 * The region is the whole of the constraint. A stack that names the region
 * and leaves its account to the environment passes, and deploys into
 * whichever account the profile names, as every other stack in the app does.
 * Which account these calls are made in has never mattered to them, and
 * asking for one would make an app that synthesises without credentials
 * write an account number down to hold a delivery.
 *
 * @throws {Error} when the stack names no region, or names another one.
 */
export function requireStackRegion(
  scope: Construct,
  requiredRegion: string,
): void {
  const stack = Stack.of(scope);

  if (Token.isUnresolved(stack.region)) {
    throw new Error(
      `Stack "${stack.stackName}" is region-agnostic, but it has to be given` +
        ` an explicit env naming the "${requiredRegion}" region.`,
    );
  }

  if (stack.region !== requiredRegion) {
    throw new Error(
      `Stack "${stack.stackName}" can only be deployed to` +
        ` "${requiredRegion}", but it is configured for "${stack.region}".`,
    );
  }
}
