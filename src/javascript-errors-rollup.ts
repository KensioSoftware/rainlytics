// The question over uncaught exceptions and unhandled promise rejections the
// browser beacon reported.

import { defaultBeaconPath } from "./beacon-events.js";
import {
  aBeaconEvent,
  beaconEventColumn,
  beaconMessageColumn,
  beaconPageColumn,
} from "./beacon-rows.js";
import { qualifiedTableName } from "./dataset.js";
import { errorEventNames, errorMessageLimit } from "./error-events.js";
import type { Rollup, RollupRequest, RollupTotals } from "./rollups.js";
import { rowsFor } from "./rollups.js";
import { oneOf } from "./sql-text.js";

/** The beacon path a request counts, with the package default filled in. */
const onBeaconPath = (request: RollupRequest): RollupRequest => ({
  ...request,
  paths: request.paths ?? [defaultBeaconPath],
});

/** Error counts added across stored windows. */
const javascriptErrorTotals: RollupTotals = { added: ["errors"] };

/** JavaScript errors by page and exact message, most reported first. */
export const javascriptErrors: Rollup = {
  name: "javascript-errors",
  summary: "Count JavaScript errors by page and message.",
  isRanked: true,
  totals: javascriptErrorTotals,
  description: `\
Counts uncaught exceptions and unhandled promise rejections by the page where
they happened and the message they carried, most reported first.

Both \`error\` and \`rejection\` rows count. Route changes, Web Vitals and events
a site named for itself are left out.

Messages are grouped exactly as they were sent, after \`reportErrors\` applied
the site's \`redact\` function and the ${String(errorMessageLimit)}-character limit. A message
containing an interpolated value can produce a row per value. Rainlytics keeps
every part of the message because an identifier that varies may be the detail
that distinguishes two failures. A site can replace variable text in \`redact\`
before sending. \`rainlytics query\` can normalise at read time when the raw
messages need to stay intact.

The collection path defaults to \`${defaultBeaconPath}\`. Use \`--path\` for a
beacon deployed somewhere else, and set the same path under \`requests\` when
adding this rollup to \`RollupSummaries\`.

Counts from stored windows add together. A ranking assembled from several
windows is approximate because each summary keeps only its own top rows.
\`--query\` calculates the ranking over the whole span instead.`,
  body: (request) =>
    [
      `SELECT ${beaconPageColumn} AS page,`,
      `  ${beaconMessageColumn} AS message,`,
      "  count(*) AS errors",
      `  FROM ${qualifiedTableName(request.dataset)}`,
      rowsFor(onBeaconPath(request), [
        ...aBeaconEvent,
        oneOf(beaconEventColumn, Object.values(errorEventNames)),
      ]),
      "  GROUP BY 1, 2",
      "  ORDER BY 3 DESC, 1, 2",
      `  LIMIT ${String(request.limit)}`,
    ].join("\n"),
};
