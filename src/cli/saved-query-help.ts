// The words `rainlytics saved-query --help` prints, kept apart from the code
// that runs the query.
//
// The same split `help-text.ts` and `query-help.ts` make, and for the same
// reason. This is documentation meant to be edited as prose.

import { defaultWorkgroupName, savedQueryPrefix } from "../dataset.js";

export const savedQueryDescription = `\
Runs a query saved in the Athena workgroup and prints the rows.

The RollupQueries construct saves one named query per rollup, and a site that
wrote a rollup of its own saves that beside them. This is how one of them
runs from a command line, without this package having shipped the question:

  rainlytics saved-query countries

The name is the one Athena lists, with or without the ${savedQueryPrefix}
prefix the construct adds. "countries" and "${savedQueryPrefix}countries"
therefore reach the same saved query. A name matching nothing is answered
with the names that are saved in the workgroup.

What a saved query covers was settled when it was saved. There is no --last,
--limit, --include-bots, --path, --host or --param here. The saved SQL
carries a range, a row count and its filters already, and this command sends
it as it was saved. A saved rollup covers the month you run it in, and the
"requests" prop on the construct is where the rest of it is decided. Athena
shows a description beside each saved query saying what that copy covers.

The database is the saved query's own, being the one it was written against.
An answer of no rows is a question about what was saved rather than about how
it was run.

--workgroup is both where the saved queries are looked for and where the one
that matches then runs. A query somebody saved by hand in the console runs
here too, whatever it selects.

What the query scanned and what that came to is written to standard error
when it finishes, so a pipeline reads rows and a person still sees the price.
Reading the saved queries costs nothing. Athena charges for the query this
then runs, at the rate "rainlytics query" describes.

Credentials come from the AWS SDK's default chain, the same one the AWS CLI
uses. The region comes from that chain too, unless --region says otherwise.
A workgroup and the queries saved in it exist in one region, and a profile
pointing somewhere else is answered "WorkGroup ${defaultWorkgroupName} is not
found."`;
