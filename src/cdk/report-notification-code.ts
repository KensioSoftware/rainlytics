// Which code the report notification publisher runs.

import {
  Code,
  Function,
  type FunctionOptions,
  type IFunction,
  Runtime,
} from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import type { Construct } from "constructs";

import type { ReportNotificationMessageProps } from "./report-notification-message-props.js";
import {
  reportNotificationHandlerName,
  summaryCodePath,
} from "./summary-code.js";

/**
 * The default publisher from Rainlytics' own package, or one bundled from the
 * site's entry.
 *
 * Both take the same logical ID, so switching between them replaces the
 * function and nothing else. A site's own environment values sit beneath the
 * publisher's, which synthesis has already checked they never name.
 */
export function reportNotificationPublisher(
  scope: Construct,
  id: string,
  options: FunctionOptions & {
    readonly environment: Readonly<Record<string, string>>;
  },
  message: ReportNotificationMessageProps | undefined,
): IFunction {
  const runtime = Runtime.NODEJS_22_X;

  return message === undefined
    ? new Function(scope, id, {
        ...options,
        runtime,
        handler: reportNotificationHandlerName,
        code: Code.fromAsset(summaryCodePath()),
      })
    : new NodejsFunction(scope, id, {
        ...options,
        runtime,
        entry: message.entry,
        handler: message.handler ?? "handler",
        environment: { ...message.environment, ...options.environment },
      });
}
