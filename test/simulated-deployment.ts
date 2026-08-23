/**
 * How a construct test gets from a Rainlytics construct to a simulated AWS
 * account with that construct deployed into it.
 *
 * Rainlytics is a library, so it has no CDK app of its own to synthesise. A
 * test builds the app instead, which is also the closest a test gets to being
 * the consumer. The app is real CDK synthesis rather than a hand-written
 * template, so a construct's own logic runs on the way through.
 *
 * Kept deliberately small. Yulin is built to be used directly, and a test
 * should still show the reader the construct going in and the resource coming
 * back out. This covers the synthesise-and-deploy sequence in between, which
 * is the same three lines every time and has nothing in it worth reading
 * twice.
 */

import { SimAws, SimFixedClock } from "@kensio/yulin";
import type { SimCfnDeployedStack } from "@kensio/yulin/cloudformation";
import { App } from "aws-cdk-lib/core";

/**
 * When a simulation starts, unless a test moves it.
 *
 * A fixed instant rather than the host clock stopped at whatever "now" was.
 * Timestamps are then the same on every run, and a failure reproduces with
 * the dates it failed with. `simAws.clock().advanceBy(...)` moves it.
 */
export const simStartedAt = new Date("2026-08-23T09:00:00.000Z");

/** A simulated account, with an app deployed into it. */
export interface SimulatedDeployment {
  /** The account, for reading state back after the code has run. */
  readonly simAws: SimAws;

  /** What went up, keyed by stack name. */
  readonly stacks: ReadonlyMap<string, SimCfnDeployedStack>;
}

/**
 * Synthesises an app and deploys every stack in it into a fresh simulated
 * account.
 *
 * Each stack lands in the region its own environment names, which is the
 * property most Rainlytics constructs care about. Log delivery has to be
 * configured from us-east-1 whatever region the bucket is in, so a consumer
 * ends up with two stacks in two regions and the tests have to be able to
 * tell them apart.
 *
 * CDK writes the cloud assembly to a temporary directory of its own choosing
 * when the app is given no `outdir`, so nothing here has a build step to run
 * first or a stale `cdk.out` to guard against.
 *
 * `defineStacks` adds the stacks under test to the app it is handed. Throwing
 * from in there, which is what a construct validating its own scope does,
 * rejects the returned promise before anything is deployed.
 */
export async function deployStacks(
  defineStacks: (app: App) => void,
): Promise<SimulatedDeployment> {
  const app = new App();
  defineStacks(app);

  const simAws = new SimAws({ clock: new SimFixedClock(simStartedAt) });
  const stacks = await simAws.cloudFormation().deployCdkOut({
    directoryPath: app.synth().directory,
  });

  return { simAws, stacks };
}
