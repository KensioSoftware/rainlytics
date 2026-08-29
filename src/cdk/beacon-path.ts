import {
  CachePolicy,
  Function as CloudFrontFunction,
  FunctionCode,
  FunctionEventType,
  FunctionRuntime,
  type AddBehaviorOptions,
  type Distribution,
  type ICachePolicy,
  type IOrigin,
} from "aws-cdk-lib/aws-cloudfront";
import { Construct } from "constructs";

import { defaultBeaconPath } from "../beacon-events.js";
import { beaconFunctionCodePath } from "./beacon-function-code.js";

/** What the beacon's collection path needs telling. */
export interface BeaconPathProps {
  /**
   * The distribution serving the site being measured.
   *
   * The construct adds a cache behaviour, and `addBehavior` is on the
   * `Distribution` class. An imported `IDistribution` has no route through
   * here. The behaviour belongs on the distribution the beacon reports to,
   * being the one already serving the pages.
   */
  readonly distribution: Distribution;

  /**
   * The origin the beacon behaviour names.
   *
   * CloudFront requires an origin on every cache behaviour and no request
   * reaches this one. The function answers at viewer-request, before the
   * cache and before any origin lookup. Pass whatever the rest of the site
   * is served from.
   */
  readonly origin: IOrigin;

  /**
   * The path the beacon reports to.
   *
   * Has to be the path the browser sends to, and has to be one nothing else
   * on the site answers. A path already serving a page would count every
   * event as a view of it.
   *
   * @default {@link defaultBeaconPath}, being `/_rainlytics`
   */
  readonly path?: string | undefined;

  /**
   * The cache policy the behaviour carries.
   *
   * Whatever it is, it has to leave the query string out of the cache key.
   * The beacon puts its payload there and every event would otherwise be a
   * cache key of its own.
   *
   * @default `CachePolicy.CACHING_OPTIMIZED`, which keys on the path alone
   */
  readonly cachePolicy?: ICachePolicy | undefined;

  /**
   * A name for the function, unique within the account.
   *
   * @default a name CDK derives from the construct's path in the tree
   */
  readonly functionName?: string | undefined;
}

/**
 * Answers the beacon's collection path with a 204, at the edge.
 *
 * The construct adds a cache behaviour to a distribution the consumer
 * already owns and attaches a CloudFront Function to it at viewer-request.
 * The function returns the response itself. The request stops there, ahead of
 * the cache and ahead of the origin, and CloudFront records it in the access
 * log like any other request. That record is the event.
 * `src/beacon-events.ts` holds the query string it travels in and the SQL
 * that reads it back.
 *
 * ```typescript
 * new BeaconPath(this, "RainlyticsBeacon", { distribution, origin });
 * ```
 *
 * A viewer-request function runs on every request to the behaviour, ahead of
 * the cache, at $0.10 per million invocations. A million beacon events
 * therefore costs ten pence in invocations on top of the CloudFront requests
 * and the log delivery, which a cached object at the same path would pay
 * anyway.
 */
export class BeaconPath extends Construct {
  /** The path the behaviour serves, and the one the beacon sends to. */
  readonly path: string;

  /** The function returning the 204. */
  readonly cloudFrontFunction: CloudFrontFunction;

  /** The cache policy the behaviour carries. */
  readonly cachePolicy: ICachePolicy;

  constructor(scope: Construct, id: string, props: BeaconPathProps) {
    super(scope, id);

    const path = props.path ?? defaultBeaconPath;
    assertMatchablePath(path);

    this.path = path;
    this.cachePolicy = props.cachePolicy ?? CachePolicy.CACHING_OPTIMIZED;

    this.cloudFrontFunction = new CloudFrontFunction(this, "Responder", {
      ...(props.functionName === undefined
        ? {}
        : { functionName: props.functionName }),
      comment: `Rainlytics beacon, answering ${path} with 204`,
      runtime: FunctionRuntime.JS_2_0,
      code: FunctionCode.fromFile({ filePath: beaconFunctionCodePath() }),
    });

    const behaviour: AddBehaviorOptions = {
      cachePolicy: this.cachePolicy,
      functionAssociations: [
        {
          function: this.cloudFrontFunction,
          eventType: FunctionEventType.VIEWER_REQUEST,
        },
      ],
    };
    props.distribution.addBehavior(path, props.origin, behaviour);
  }
}

/**
 * Refuses a path CloudFront would accept as a pattern and never match.
 *
 * A CloudFront path pattern is allowed to start with anything, and `*.jpg`
 * is a normal one. A beacon path without its leading slash therefore deploys
 * green and matches no request the beacon sends, and the first sign of it is
 * a dataset with no beacon rows in it.
 *
 * `?` is refused for the same reason. The payload goes in the query string
 * and a pattern is matched against the path alone.
 */
function assertMatchablePath(path: string): void {
  const complaint = path.startsWith("/")
    ? path.includes("?")
      ? "carries a query string"
      : undefined
    : "has no leading slash";

  if (complaint !== undefined) {
    throw new Error(
      `The beacon path ${JSON.stringify(path)} ${complaint}. CloudFront takes` +
        ` it as a cache behaviour's path pattern and would match no request` +
        ` the beacon sends. Give a path like ${defaultBeaconPath}.`,
    );
  }
}
