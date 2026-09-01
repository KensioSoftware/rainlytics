// Reading report notification inputs from S3.

import { GetObjectCommand, type S3Client } from "@aws-sdk/client-s3";

/** Reads and consumes one S3 object body. */
export async function reportNotificationObjectBody(
  client: S3Client,
  bucket: string,
  key: string,
): Promise<string> {
  try {
    const found = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    const body = await found.Body?.transformToString();
    if (body === undefined) {
      throw new Error(`S3 returned no body for ${key} in ${bucket}.`);
    }
    return body;
  } catch (error) {
    if (isMissingReportNotificationObject(error)) {
      const missing = new Error(`S3 has no object ${key} in ${bucket}.`, {
        cause: error,
      });
      missing.name = "NoSuchKey";
      throw missing;
    }
    throw error;
  }
}

/** Whether S3 reports that an object is absent. */
export function isMissingReportNotificationObject(error: unknown): boolean {
  const { name } = error as { name?: string };
  return name === "NoSuchKey" || name === "NotFound";
}
