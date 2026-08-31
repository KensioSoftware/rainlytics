// Reading source summaries and writing calendar reports in one S3 bucket.

import type * as S3 from "@aws-sdk/client-s3";

import type { ReportDocument } from "../report-document.js";
import type { SummaryLookup } from "../rollup-summaries.js";
import { neverComputed } from "../rollup-summaries.js";

/** The S3 operations one report run uses. */
export interface ReportStore {
  readonly read: (keys: readonly string[]) => Promise<readonly SummaryLookup[]>;
  readonly write: (key: string, document: ReportDocument) => Promise<void>;
  readonly close: () => void;
}

/** Opens the bucket that holds both source summaries and reports. */
export async function openReportStore(bucket: string): Promise<ReportStore> {
  const s3: typeof S3 = await import("@aws-sdk/client-s3");
  const client = new s3.S3Client({});

  return {
    read: async (keys) =>
      Promise.all(keys.map(async (key) => read(client, s3, bucket, key))),
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

/** One source object, or the explicit missing value. */
async function read(
  client: S3.S3Client,
  s3: typeof S3,
  bucket: string,
  key: string,
): Promise<SummaryLookup> {
  try {
    const found = await client.send(
      new s3.GetObjectCommand({ Bucket: bucket, Key: key }),
    );

    return JSON.parse(
      (await found.Body?.transformToString()) ?? "",
    ) as SummaryLookup;
  } catch (error) {
    const { name } = error as { name?: string };

    if (name === "NoSuchKey" || name === "NotFound") {
      return neverComputed;
    }

    throw error;
  }
}
