// Writing one completion manifest per report day.

import type * as S3 from "@aws-sdk/client-s3";

import type { ReportNotificationManifest } from "../report-notification-manifest.js";

/** Writes a manifest unless its one-send key already exists. */
export async function writeReportNotificationManifest(
  client: S3.S3Client,
  s3: typeof S3,
  bucket: string,
  key: string,
  manifest: ReportNotificationManifest,
): Promise<"written" | "already-exists"> {
  if (await objectExists(client, s3, bucket, key)) {
    return "already-exists";
  }

  try {
    await client.send(
      new s3.PutObjectCommand({
        Bucket: bucket,
        Key: key,
        Body: JSON.stringify(manifest),
        ContentType: "application/json",
        IfNoneMatch: "*",
      }),
    );
    return "written";
  } catch (error) {
    if ((error as { name?: string }).name === "PreconditionFailed") {
      return "already-exists";
    }
    throw error;
  }
}

/** Whether a notification manifest already occupies its one-send key. */
async function objectExists(
  client: S3.S3Client,
  s3: typeof S3,
  bucket: string,
  key: string,
): Promise<boolean> {
  try {
    await client.send(new s3.HeadObjectCommand({ Bucket: bucket, Key: key }));
    return true;
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === "NoSuchKey" || name === "NotFound") {
      return false;
    }
    throw error;
  }
}
