// The two options a named question takes for reading precomputed answers, and
// the words that describe them.
//
// Apart from the commands for the reason `help-text.ts` is apart from
// `help.ts`. This is documentation, meant to be edited as prose.

import { summaryEnvironment } from "../functions/summary-deployment.js";
import type { CliOption } from "./option.js";

/**
 * The environment variable naming the bucket to read.
 *
 * The same variable `RollupSummaries` sets on its job, taken from there. Both
 * halves are naming one bucket, and a second spelling of the name is the copy
 * that goes stale.
 */
export const summaryBucketVariable = summaryEnvironment.bucket;

export const summariesOption: CliOption = {
  name: "summaries",
  short: "s",
  type: "string",
  valueName: "bucket",
  description:
    `The S3 bucket holding the precomputed answers, as the` +
    ` RollupSummaries construct writes them. Defaults to` +
    ` ${summaryBucketVariable} in the environment. Reading one costs a GET,` +
    ` and this is what makes an answer cost that rather than a query.`,
};

export const queryOption: CliOption = {
  name: "query",
  type: "boolean",
  description:
    "Run the query instead of reading a summary. Athena counts the whole" +
    " span from raw, which is the fresher answer and the one that covers a" +
    " window no schedule has computed. It is charged per byte scanned, and" +
    " the command says what it came to.",
};

/**
 * What every named question says about where its answer came from.
 *
 * Appended to each rollup's own description, so the filters that decide
 * whether a summary can answer are read at `--help` and never discovered.
 */
export const readingASummary = `\
The answer comes from the summaries a schedule computed, at the cost of a GET
per window. Standard error says which windows were read and how old they are.
--query runs the question through Athena instead.

A summary answers the question it was computed with. --path, --host,
--include-bots, --param and --redirect-status each decide which requests were
counted, and a schedule cannot compute every combination of them.
RollupSummaries computes the unfiltered form, and its \`requests\` prop is where
a deployment adds a narrowed one. A run whose filters no stored summary
matches says what was stored and stops, so nothing quietly falls back to a
query nobody chose.

A run that names none of those five takes the ones the summaries were computed
with, and standard error says which. The deployment declared its narrowing on
RollupSummaries and this command reads that copy back. A shell alias never has
to carry a second one. An option somebody typed is still theirs, and still
refused where no stored summary matches it.

--limit is apart from those five. A row count decides how much of a ranked
answer is printed and leaves what was counted where it was, so a deployment
computing the top hundred still answers this command's own default. A summary
holding fewer rows than that cuts the answer down and says so, and a row count
somebody typed is refused instead.

A range is covered by whole UTC windows, days wherever a whole day fits and
hours at the two edges. The part hours at either end have no stored window, so
a span always reads a little short of the one asked for. Standard error names
the span that answered.

A ranked answer assembled from several windows is approximate. A row that fell
outside the stored rows of every window is missing from all of them, and
--query ranks the whole span in one pass.`;
