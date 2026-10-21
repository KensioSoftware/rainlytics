// What `rainlytics backfill` writes to standard error as it goes.

import { queryChargeInDollars } from "../athena-pricing.js";
import type { BackfillProgress } from "../summary-backfill.js";
import type { BackfillRequest } from "./backfill-request.js";
import { inDollars } from "./query-report.js";

/** What the command is about to do, and the least Athena will bill for it. */
export function backfillPlanned(
  asked: BackfillRequest,
  windows: number,
  payload: Readonly<Record<string, unknown>>,
): string {
  const queries = windows * (typeof payload["visitorSql"] === "string" ? 2 : 1);

  return (
    `Backfilling ${String(windows)} ${asked.granularity} window(s) of` +
    ` ${asked.question} from ${asked.schedule}. That is ${String(queries)}` +
    ` Athena queries, billed at least` +
    ` ${inDollars(queries * queryChargeInDollars(0))} between them.\n`
  );
}

/** One invocation's progress, for standard error. */
export function backfillProgressed(progress: BackfillProgress): string {
  const { computed, next } = progress;
  const span =
    computed.length === 0
      ? "no windows"
      : `${String(computed.length)} window(s), ${String(computed[0])} to ${String(computed.at(-1))}`;
  const carrying =
    next === undefined
      ? "The range is done."
      : `Carrying on from ${String((next["backfill"] as { from?: unknown } | undefined)?.from)}.`;

  return `Wrote ${span}. ${carrying}\n`;
}
