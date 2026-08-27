// Where a computed summary is put.
//
// The S3 client is loaded when the job actually writes, for the reason
// `athena-query.ts` gives at length. A Lambda runtime provides the AWS SDK,
// so the deployment package carries none of it and stays a few tens of
// kilobytes.

import type * as S3 from "@aws-sdk/client-s3";

import type { RollupSummary } from "../rollup-summaries.js";

/** Somewhere to put the summaries one run computed. */
export interface SummaryStore {
  /** Write one document, replacing whatever was under that key. */
  write: (key: string, document: RollupSummary) => Promise<void>;

  /** Let go of the client. */
  close: () => void;
}

/**
 * A store over one bucket, holding one client for the whole run.
 *
 * A run writes a summary per window and each write replaces what a previous
 * run of the same window left. That is what makes recomputing a window for
 * late records a re-run of the job rather than a merge, and what makes a bug
 * in a rollup a re-run rather than an incident.
 */
export async function openSummaryStore(bucket: string): Promise<SummaryStore> {
  const s3: typeof S3 = await import("@aws-sdk/client-s3");
  const client = new s3.S3Client({});

  return {
    write: async (key, document) => {
      await client.send(
        new s3.PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: JSON.stringify(document),
          ContentType: "application/json",
        }),
      );
    },
    close: () => {
      client.destroy();
    },
  };
}
