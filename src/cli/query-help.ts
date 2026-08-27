// The words `rainlytics query --help` prints, kept apart from the code that
// runs the query.
//
// The same split `help-text.ts` makes for the root help, and for the same
// reason. This is documentation meant to be edited as prose.

import { defaultLogDataset, defaultWorkgroupName } from "../dataset.js";
import type { CliOption } from "./option.js";

export const databaseOption: CliOption = {
  name: "database",
  short: "d",
  type: "string",
  valueName: "name",
  description:
    `The Glue database an unqualified table name is resolved against.` +
    ` Defaults to ${defaultLogDataset.databaseName}, which is what the` +
    ` LogTable construct creates.`,
};

export const workgroupOption: CliOption = {
  name: "workgroup",
  short: "w",
  type: "string",
  valueName: "name",
  description:
    `The Athena workgroup to run in, which carries the bytes-scanned cutoff` +
    ` and the results location. Defaults to ${defaultWorkgroupName}, which` +
    ` is what the QueryWorkgroup construct creates. Athena's own "primary"` +
    ` workgroup has no cutoff at all.`,
};

export const queryDescription = `\
Runs SQL against the Rainlytics log table and prints the rows.

The SQL is one argument, so it has to be quoted. A shell splits an unquoted
query on spaces and eats the quotes inside it, which leaves Athena a
different question from the one that was asked.

  rainlytics query "SELECT cs_uri_stem, count(*) AS views
    FROM cloudfront_logs
    WHERE year = '2026' AND month = '08' AND day = '27'
    GROUP BY 1 ORDER BY 2 DESC LIMIT 5"

Athena bills per byte scanned, so name the partition columns wherever the
question allows it. distributionid, year, month, day and hour are the
partition keys, and a predicate on any of them cuts what is read. A predicate
on anything else narrows the rows after they have been read, and the bytes
are billed either way.

What the query scanned and what that came to is written to standard error
when it finishes, so a pipeline reads rows and a person still sees the price.

The workgroup puts a ceiling on one query. A query that would scan past it is
stopped, and the message says what it read and what the workgroup allows.

Credentials, region and profile come from the AWS SDK's default chain, the
same one the AWS CLI uses. There is nothing Rainlytics-specific to configure.`;
