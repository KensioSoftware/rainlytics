// What the scheduled job is allowed to do.
//
// Athena runs the query and reads the objects as whoever started it, so this
// role needs the log bucket as well as Athena itself. Written out rather than
// taken from a managed policy, because `AmazonAthenaFullAccess` carries Glue
// writes, workgroup administration and a handful of other services, and this
// job reads one table and writes one prefix.

import type { IGrantable } from "aws-cdk-lib/aws-iam";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Stack } from "aws-cdk-lib/core";
import type { Construct } from "constructs";

import type { LogDataset } from "../dataset.js";
import type { LogDeliveryBucket } from "./delivery-bucket.js";

/**
 * Running one query in one workgroup, and stopping it.
 *
 * The cutoff and the results location are the workgroup's, so a job that can
 * only start queries there cannot escape either of them.
 */
export function athenaStatements(
  scope: Construct,
  workgroupName: string,
): readonly PolicyStatement[] {
  return [
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "athena:StartQueryExecution",
        "athena:StopQueryExecution",
        "athena:GetQueryExecution",
        "athena:GetQueryResults",
      ],
      resources: [
        Stack.of(scope).formatArn({
          service: "athena",
          resource: "workgroup",
          resourceName: workgroupName,
        }),
      ],
    }),
  ];
}

/**
 * Reading the table definition out of the Data Catalog.
 *
 * Reads alone. Athena needs the database and the table to plan a query, and
 * the partitions are projected rather than registered, so nothing here writes
 * to the catalog and nothing lists it.
 */
export function catalogStatements(
  scope: Construct,
  dataset: LogDataset,
): readonly PolicyStatement[] {
  const arnOf = (resource: string, resourceName: string): string =>
    Stack.of(scope).formatArn({ service: "glue", resource, resourceName });

  return [
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions"],
      resources: [
        arnOf("catalog", ""),
        arnOf("database", dataset.databaseName),
        arnOf("table", `${dataset.databaseName}/${dataset.tableName}`),
      ],
    }),
  ];
}

/**
 * Reading the delivered log objects.
 *
 * `ListBucket` alongside `GetObject` because Athena lists the prefixes a
 * partition predicate selected before it reads anything in them. A role with
 * the read and not the list reports an empty answer for a window that has
 * data in it.
 */
export function logReadStatements(
  bucket: LogDeliveryBucket,
  grantee: IGrantable,
): readonly PolicyStatement[] {
  bucket.encryptionKey?.grantDecrypt(grantee);

  return [
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["s3:GetObject", "s3:GetBucketLocation", "s3:ListBucket"],
      resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
    }),
  ];
}
