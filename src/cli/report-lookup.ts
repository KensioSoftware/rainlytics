// Reading one precomputed calendar report from S3.

import type * as S3 from "@aws-sdk/client-s3";

import type { ReportDocument } from "../report-document.js";
import { reportKey } from "../report-key.js";
import type { ReportPeriod } from "../report-periods.js";
import { messageOf } from "../thrown-message.js";
import { cannotReadReport, isDenied } from "./access-refusals.js";
import { reportDocumentFrom, unsupported } from "./report-document-reading.js";

/** One supported, complete report read from S3. */
export interface ReportRead {
  readonly bucket: string;
  readonly key: string;
  readonly document: ReportDocument;
  readonly lastModified: Date;
}

/** Reads the deterministic key for one report period. */
export async function readReport(
  bucket: string,
  region: string | undefined,
  period: ReportPeriod,
): Promise<ReportRead> {
  const s3: typeof S3 = await import("@aws-sdk/client-s3");
  const client = new s3.S3Client(region === undefined ? {} : { region });
  const key = reportKey(period);

  try {
    const found = await getReport(client, s3, bucket, key, period);
    const body = await found.Body?.transformToString();

    if (body === undefined) {
      throw unsupported(bucket, key, "S3 returned no document body");
    }

    const document = reportDocumentFrom(body, bucket, key, period);

    return {
      bucket,
      key,
      document,
      lastModified: found.LastModified ?? new Date(document.computedAt),
    };
  } finally {
    client.destroy();
  }
}

/** Gets one object and explains S3 failures in report terms. */
async function getReport(
  client: S3.S3Client,
  s3: typeof S3,
  bucket: string,
  key: string,
  period: ReportPeriod,
): Promise<S3.GetObjectCommandOutput> {
  try {
    return await client.send(
      new s3.GetObjectCommand({ Bucket: bucket, Key: key }),
    );
  } catch (error) {
    if (isMissing(error)) {
      throw new Error(
        `No ${period.unit} report starting ${period.startsOn} exists in` +
          ` ${bucket}. S3 was asked for ${key}. RollupSummaries writes the` +
          ` report after the period closes. Reading it never falls back to` +
          ` Athena.`,
        { cause: error },
      );
    }

    if (isDenied(error)) {
      throw cannotReadReport(error, bucket);
    }

    throw new Error(
      `${messageOf(error)} S3 was asked for the report ${key} in ${bucket}.` +
        ` Name another bucket with --summaries, or the region it is in` +
        ` with --region.`,
      { cause: error },
    );
  }
}

/** Whether S3 answered that the key was absent. */
function isMissing(error: unknown): boolean {
  const { name } = error as { name?: string };

  return name === "NoSuchKey" || name === "NotFound";
}
