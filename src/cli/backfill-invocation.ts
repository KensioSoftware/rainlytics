// Reading a summary schedule, and invoking its function with a range added.
//
// The payload comes from the schedule rather than being built here. The
// schedule holds the SQL the deployment wrote at synthesis, with whatever
// filters and site-specific questions that deployment has, and a payload
// rebuilt from this package's defaults would compute a different question
// under the same key.
//
// Both clients are loaded when the command runs, for the reason
// `athena-query.ts` gives.

import type * as Lambda from "@aws-sdk/client-lambda";
import type * as Scheduler from "@aws-sdk/client-scheduler";

import type { BackfillProgress } from "../summary-backfill.js";
import { failureMessage, progressFrom } from "./backfill-answer.js";
import type { BackfillRequest } from "./backfill-request.js";

/** What a summary schedule invokes, and with what. */
export interface ScheduledTarget {
  /** The function's ARN. */
  readonly function: string;

  /** The payload the schedule sends. */
  readonly payload: Readonly<Record<string, unknown>>;
}

/**
 * The function and payload one summary schedule fires with.
 *
 * @throws {Error} for a schedule that does not exist, naming the prefix that
 *   built its name, since a second deployment's prefix is the usual reason.
 */
export async function scheduledTarget(
  request: BackfillRequest,
): Promise<ScheduledTarget> {
  const scheduler: typeof Scheduler = await import("@aws-sdk/client-scheduler");
  const client = new scheduler.SchedulerClient(
    request.region === undefined ? {} : { region: request.region },
  );

  try {
    const found = await client.send(
      new scheduler.GetScheduleCommand({ Name: request.schedule }),
    );
    const target = found.Target;

    if (target?.Arn === undefined || target.Input === undefined) {
      throw new Error(
        `The schedule ${request.schedule} has no target input. RollupSummaries` +
          ` writes the question into it, so this schedule was made by` +
          ` something else.`,
      );
    }

    return {
      function: target.Arn,
      payload: JSON.parse(target.Input) as Readonly<Record<string, unknown>>,
    };
  } catch (error) {
    if ((error as { name?: string }).name === "ResourceNotFoundException") {
      throw new Error(
        `There is no schedule called ${request.schedule}. RollupSummaries` +
          ` names one per question per granularity, as the prefix, the` +
          ` question and the granularity. Pass --schedule-prefix where the` +
          ` deployment set schedulePrefix, or --region where it is elsewhere.`,
        { cause: error },
      );
    }

    throw error;
  } finally {
    client.destroy();
  }
}

/**
 * How long the command waits on one invocation.
 *
 * Past the fifteen minutes Lambda allows a function, so the function's own
 * timeout is what ends a slow invocation and the command reports what Lambda
 * said about it.
 */
const invocationWait = 16 * 60 * 1000;

/** Somewhere to send one stretch of a backfill. */
export interface BackfillInvoker {
  /** Invokes the function and answers with what it computed. */
  invoke: (
    payload: Readonly<Record<string, unknown>>,
  ) => Promise<BackfillProgress>;

  /** Let go of the client. */
  close: () => void;
}

/** An invoker over one function, holding one client for the whole backfill. */
export async function openBackfillInvoker(
  target: ScheduledTarget,
  region: string | undefined,
): Promise<BackfillInvoker> {
  const lambda: typeof Lambda = await import("@aws-sdk/client-lambda");
  const client = new lambda.LambdaClient({
    ...(region === undefined ? {} : { region }),
    requestHandler: { requestTimeout: invocationWait },
  });

  return {
    invoke: async (payload) => {
      const sent = JSON.stringify(payload);
      const answered = await client.send(
        new lambda.InvokeCommand({
          FunctionName: target.function,
          InvocationType: "RequestResponse",
          Payload: new TextEncoder().encode(sent),
        }),
      );
      const body = new TextDecoder().decode(answered.Payload);

      if (answered.FunctionError !== undefined) {
        throw new Error(
          `The summary function failed. ${failureMessage(body)} Its log` +
            ` group has the rest. Windows before the one it was on are` +
            ` written, and the last progress line says where to start again.`,
        );
      }

      return progressFrom(body);
    },
    close: () => {
      client.destroy();
    },
  };
}
