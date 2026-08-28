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
        // Athena reads the workgroup's own configuration on the way to
        // running a query in it, and refuses the query without this.
        "athena:GetWorkGroup",
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
  const stack = Stack.of(scope);

  return [
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["glue:GetDatabase", "glue:GetTable", "glue:GetPartitions"],
      resources: [
        // The catalog's own ARN ends at the word, with nothing after it. A
        // resource name of `""` would put a separator on the end, and Glue
        // matches an ARN that shape against nothing.
        stack.formatArn({ service: "glue", resource: "catalog" }),
        stack.formatArn({
          service: "glue",
          resource: "database",
          resourceName: dataset.databaseName,
        }),
        stack.formatArn({
          service: "glue",
          resource: "table",
          resourceName: `${dataset.databaseName}/${dataset.tableName}`,
        }),
      ],
    }),
  ];
}

/**
 * Reading the parameter holding the visitor salt secret.
 *
 * `GetParameter` on the one parameter, and nothing on KMS. The parameter is a
 * `SecureString` under the `aws/ssm` managed key, whose own policy admits the
 * account's principals when the request reached KMS through Systems Manager.
 * A site naming a customer key of its own grants `kms:Decrypt` on it as well,
 * the way a customer-encrypted log bucket hands out its own.
 *
 * Granted whether or not any of this deployment's questions count visitors. A
 * statement naming a parameter nobody reads costs nothing, and a question
 * gaining a visitor count later is then a template change rather than a run
 * that fails on a permission.
 */
export function visitorSaltStatements(
  scope: Construct,
  parameter: string,
): readonly PolicyStatement[] {
  return [
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["ssm:GetParameter"],
      resources: [
        Stack.of(scope).formatArn({
          service: "ssm",
          resource: "parameter",
          // A parameter name opens with a slash and its ARN does not repeat
          // one. `/rainlytics/visitor-salt` is `...:parameter/rainlytics/...`.
          resourceName: parameter.replace(/^\//u, ""),
        }),
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
 *
 * The grantee is taken as well as given a statement, because a bucket
 * encrypted with a customer key hands out its own decrypt permission and
 * there is nothing here to add to the statement for it.
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
