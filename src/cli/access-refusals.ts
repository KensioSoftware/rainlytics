// What a command says where AWS refuses the caller for want of a permission.
//
// A refusal to run a query is the failure where the message decides whether
// the reader gets an answer at all. An identity that may not query can nearly
// always still read a summary, and the four actions between it and a query are
// short enough to name.
//
// Apart from the commands for the reason `summary-refusals.ts` is apart from
// `summary-answer.ts`. These are sentences somebody reads at a terminal after
// a command gave them nothing, and they are meant to be edited as prose.

import { rollups } from "../rollup-questions.js";
import { messageOf } from "../thrown-message.js";
import { summaryBucketVariable } from "./summary-help.js";
import { listOf } from "./text-layout.js";

/**
 * Whether AWS refused the call because the identity may not make it.
 *
 * Matched on the error's name, the way `summary-lookup.ts` matches a missing
 * object. S3 answers `AccessDenied`. Athena and most of the rest answer
 * `AccessDeniedException`. The SDK reports either under `name`, whatever
 * version it is on.
 *
 * The status is left out of this. A 403 also covers an expired token and a
 * signature the service would not verify, and a reader whose credentials are
 * the problem should not be sent to look at IAM.
 *
 * The cause is checked as well as the error itself, since `refusalIn` wraps
 * what the SDK threw to put the region on the end of it.
 */
export function isDenied(thrown: unknown): boolean {
  return namesADenial(thrown) || namesADenial(causeOf(thrown));
}

/**
 * What a caller who cannot run a query is told.
 *
 * The region sentence `refusalIn` adds is dropped here. It answers a question
 * this reader did not ask, and the resource in AWS's own message already
 * carries the region.
 *
 * The four actions are the ones an identity with `ReadOnlyAccess` is missing,
 * measured in KensioSoftware/rainlytics#83. `docs/query-workgroup/` has the
 * whole policy, including the reads that role already allows.
 */
export function cannotRunQueries(thrown: unknown, workgroup: string): Error {
  const questions = listOf(rollups.map((rollup) => rollup.name));

  return new Error(
    `${saidBy(thrown)}\n` +
      `Running a query takes athena:StartQueryExecution and` +
      ` athena:StopQueryExecution on the ${workgroup} workgroup, and` +
      ` s3:PutObject and s3:AbortMultipartUpload on the bucket that workgroup` +
      ` writes results to. A named question (${questions}) answers from a` +
      ` precomputed summary on s3:GetObject alone. Name the bucket holding` +
      ` those with --summaries, or put it in ${summaryBucketVariable}.`,
    { cause: thrown },
  );
}

/**
 * What a caller who cannot read the summaries is told.
 *
 * The bucket is named for the reason `refusalFor` names it. S3 says what it
 * refused and never which of the pipeline's buckets it was about.
 */
export function cannotReadSummaries(thrown: unknown, bucket: string): Error {
  return new Error(
    `${saidBy(thrown)} S3 was asked for the summaries in ${bucket}. Reading` +
      ` one takes s3:GetObject on that bucket.`,
    { cause: thrown },
  );
}

/** What a caller who cannot read a calendar report is told. */
export function cannotReadReport(thrown: unknown, bucket: string): Error {
  return new Error(
    `${saidBy(thrown)} S3 was asked for a calendar report in ${bucket}.` +
      ` Reading one takes s3:GetObject on that bucket.`,
    { cause: thrown },
  );
}

/** What the service said, out from under whatever wrapped it. */
function saidBy(thrown: unknown): string {
  return messageOf(causeOf(thrown) ?? thrown);
}

/** The error something was thrown over, where there was one. */
function causeOf(thrown: unknown): unknown {
  return thrown instanceof Error ? thrown.cause : undefined;
}

/** Whether an error carries the name AWS gives a refused permission. */
function namesADenial(thrown: unknown): boolean {
  const { name } = (thrown ?? {}) as { name?: string };

  return name === "AccessDenied" || name === "AccessDeniedException";
}
