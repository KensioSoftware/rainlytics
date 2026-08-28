// Which options one rollup command carries.
//
// Apart from `rollup-help.ts`, which describes each option as prose. This is
// the assembly, and it reaches across to `query-help.ts` for the three
// options every command that talks to Athena takes.

import type { Rollup } from "../rollups.js";
import type { CliOption } from "./option.js";
import { databaseOption, regionOption, workgroupOption } from "./query-help.js";
import {
  hostOption,
  includeBotsOption,
  lastOption,
  limitOption,
  paramOption,
  pathOption,
  redirectStatusOption,
} from "./rollup-help.js";
import { queryOption, summariesOption } from "./summary-help.js";

/**
 * Every option one rollup command accepts, in the order help prints them.
 *
 * Assembled here beside the descriptions rather than next to the command, so
 * that adding an option is one edit in one file. Three of them vary. The
 * rollup answering a single row has nothing to limit, only a question about
 * what somebody typed has a parameter to be told about, and only the one
 * counting redirects has statuses to be told about.
 *
 * `--summaries` and `--query` come before the three every command that
 * reaches Athena takes. A named question reads a precomputed answer, and the
 * database, the workgroup and the region apply to the run that chose the
 * query.
 */
export function rollupOptions(rollup: Rollup): readonly CliOption[] {
  return [
    lastOption,
    pathOption,
    hostOption,
    ...(rollup.namesAParameter === true ? [paramOption] : []),
    ...(rollup.countsRedirects === true ? [redirectStatusOption] : []),
    includeBotsOption,
    ...(rollup.isRanked ? [limitOption] : []),
    summariesOption,
    queryOption,
    databaseOption,
    workgroupOption,
    regionOption,
  ];
}
