// The options and help for `rainlytics backfill`.

import { savedQueryPrefix } from "../dataset.js";
import type { CliOption } from "./option.js";
import { regionOption } from "./query-help.js";

export const backfillFromOption: CliOption = {
  name: "from",
  type: "string",
  valueName: "instant",
  description:
    `Where the range starts, as YYYY-MM-DD for midnight UTC or as an ISO 8601` +
    ` instant with its offset, such as 2026-09-11T06:00Z. The window holding` +
    ` it is the oldest one computed. Required.`,
};

export const backfillUntilOption: CliOption = {
  name: "until",
  type: "string",
  valueName: "instant",
  description:
    `Where the range ends, written the same way. It is outside the range.` +
    ` Defaults to now. Only windows that have closed are computed either way.`,
};

export const backfillSchedulePrefixOption: CliOption = {
  name: "schedule-prefix",
  type: "string",
  valueName: "prefix",
  description:
    `What the deployment's schedule names begin with. Defaults to` +
    ` ${savedQueryPrefix}, matching RollupSummaries. Use the schedulePrefix` +
    ` passed to it when it differs.`,
};

export const backfillOptions: readonly CliOption[] = [
  backfillFromOption,
  backfillUntilOption,
  backfillSchedulePrefixOption,
  regionOption,
];

export const backfillDescription = `\
Computes the stored summaries of one question over a range of closed windows,
for windows the schedule never wrote. A run that failed while its window was
the newest one, because the visitor salt was missing for example, leaves a gap
the schedule does not go back for. The raw logs are still in the log bucket,
and this fills the gap from them.

  rainlytics backfill pageviews hourly --from 2026-09-11
  rainlytics backfill pageviews daily --from 2026-09-11 --until 2026-10-21

The first argument is the question and the second is hourly or daily. The
command reads that question's schedule from EventBridge Scheduler and invokes
the function it targets with the schedule's own payload and the range added.
The windows are computed by the same code and the same SQL as a scheduled run,
and written under the same keys. Running a backfill twice writes the same
summaries twice.

One invocation computes windows oldest first until it nears the function's
timeout, then answers with where to carry on. The command invokes again from
there until the range is done, and reports each invocation on standard error.
A month of hourly windows takes several. A range that fails part-way can be
run again from where the last report says it reached.

Every window runs one Athena query, and a second where the question counts
visitors. Each query is billed at least 10 MB. The command prints the number
of windows and what that minimum comes to before it starts.

Calendar reports are composed from the stored summaries. Backfill the
summaries first, and then the reports. docs/summary-schedule/ has the second
step.

Credentials and the region come from the AWS SDK's default chain. The identity
needs scheduler:GetSchedule on the schedule and lambda:InvokeFunction on the
summary function. The function itself does the querying and the writing with
its own role.`;
