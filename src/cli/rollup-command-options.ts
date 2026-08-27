// Which options one rollup command carries.
//
// Apart from `rollup-help.ts`, which describes each option as prose. This is
// the assembly, and it reaches across to `query-help.ts` for the two options
// every command that talks to Athena takes.

import type { Rollup } from "../rollups.js";
import type { CliOption } from "./option.js";
import { databaseOption, workgroupOption } from "./query-help.js";
import {
  hostOption,
  includeBotsOption,
  lastOption,
  limitOption,
  paramOption,
  pathOption,
} from "./rollup-help.js";

/**
 * Every option one rollup command accepts, in the order help prints them.
 *
 * Assembled here beside the descriptions rather than next to the command, so
 * that adding an option is one edit in one file. Two of them vary. The
 * rollup answering a single row has nothing to limit, and only a question
 * about what somebody typed has a parameter to be told about.
 */
export function rollupOptions(rollup: Rollup): readonly CliOption[] {
  return [
    lastOption,
    pathOption,
    hostOption,
    ...(rollup.namesAParameter === true ? [paramOption] : []),
    includeBotsOption,
    ...(rollup.isRanked ? [limitOption] : []),
    databaseOption,
    workgroupOption,
  ];
}
