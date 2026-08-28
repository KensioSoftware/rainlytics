// Fetching precomputed answers out of the bucket a deployment writes them to.
//
// The S3 client is loaded when a command actually reads, for the reason
// `athena-query.ts` gives at length. `rainlytics --help` loads no client, and
// `scripts/sh/pack-check.sh` runs the packed CLI out of a tarball with no
// `node_modules` anywhere above it.
//
// One client for the whole run and one GET per window. A week of pageviews is
// 29 objects at a few hundred bytes each, and the whole read costs about a
// hundredth of a cent. That figure is the point of the issue this file exists
// for.

import type * as S3 from "@aws-sdk/client-s3";

import type { SummaryLookup } from "../rollup-summaries.js";
import { neverComputed } from "../rollup-summaries.js";
import { messageOf } from "../thrown-message.js";

/** Where the summaries a command reads are kept. */
export interface SummaryLocation {
  /** The bucket `RollupSummaries` writes into. */
  readonly bucket: string;

  /** The region to ask, or the AWS SDK's default chain where none is given. */
  readonly region: string | undefined;
}

/**
 * What the objects under a list of keys hold, in the order the keys came in.
 *
 * A key nothing has written comes back as {@link neverComputed}. That is a
 * different answer from a document holding no rows, and `docs/summaries/` has
 * the three cases a reader meets.
 *
 * Every key is asked for at once. A month is at most 73 objects, since a range
 * is covered by whole days wherever one fits and by hours only at its two
 * edges. A month of days assembled from their hours is 648, and the SDK's own
 * connection pool holds however many are in flight to 50.
 *
 * @throws {Error} for anything other than a missing object, carrying what S3
 *   said and the bucket it was asked about. A bucket in another region and a
 *   role without `s3:GetObject` both land here, and both read as an empty
 *   answer without it.
 */
export async function readSummaries(
  where: SummaryLocation,
  keys: readonly string[],
): Promise<readonly SummaryLookup[]> {
  const s3: typeof S3 = await import("@aws-sdk/client-s3");
  const client = new s3.S3Client(
    where.region === undefined ? {} : { region: where.region },
  );

  try {
    return await Promise.all(
      keys.map(async (key) => readSummary(client, s3, where, key)),
    );
  } finally {
    client.destroy();
  }
}

/** Whatever is under one key. */
async function readSummary(
  client: S3.S3Client,
  s3: typeof S3,
  where: SummaryLocation,
  key: string,
): Promise<SummaryLookup> {
  try {
    const found = await client.send(
      new s3.GetObjectCommand({ Bucket: where.bucket, Key: key }),
    );

    return JSON.parse(
      (await found.Body?.transformToString()) ?? "",
    ) as SummaryLookup;
  } catch (error) {
    if (isMissing(error)) {
      return neverComputed;
    }

    throw refusalFor(error, where);
  }
}

/**
 * Whether S3 answered that the object was absent.
 *
 * Matched on the error's name, which is what the SDK reports the same way
 * whatever version it is. `NoSuchKey` is what `GetObject` answers, and a
 * bucket holding nothing answers it for every key.
 *
 * The status is deliberately left out of this. `NoSuchBucket` is a 404 too,
 * and a run pointed at a mistyped bucket would report every window as one
 * nobody has computed. A bucket that is not there is worth its own message.
 */
function isMissing(error: unknown): boolean {
  const { name } = error as { name?: string };

  return name === "NoSuchKey" || name === "NotFound";
}

/**
 * What S3 refused, with the bucket it was asked about.
 *
 * S3 names the problem and never the bucket, and a reader meeting
 * `Access Denied` has no way to tell which of the two buckets in the pipeline
 * it was about.
 */
function refusalFor(thrown: unknown, where: SummaryLocation): Error {
  return new Error(
    `${messageOf(thrown)} S3 was asked for the summaries in` +
      ` ${where.bucket}. Name another bucket with --summaries, or the region` +
      ` it is in with --region.`,
  );
}
