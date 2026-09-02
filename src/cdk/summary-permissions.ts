// What running a Rainlytics query takes, statement by statement.
//
// The scheduled job holds these, and so does any identity a site hands to
// `QueryWorkgroup.grantQuerying`. One definition for both, because a query
// started from a Lambda function and a query started from a terminal reach
// the same workgroup, the same catalog and the same two buckets.
//
// Athena runs the query and reads the objects as whoever started it, so a
// caller needs the log bucket and the results bucket as well as Athena
// itself. Written out rather than taken from a managed policy, because
// `AmazonAthenaFullAccess` carries Glue writes, workgroup administration and
// a handful of other services, and this reads one table and writes one
// prefix.

import type { IGrantable } from "aws-cdk-lib/aws-iam";
import { Effect, PolicyStatement } from "aws-cdk-lib/aws-iam";
import { Stack } from "aws-cdk-lib/core";
import type { Construct } from "constructs";

import type { LogDataset } from "../dataset.js";
import type { LogDeliveryBucket } from "./delivery-bucket.js";
import type { LogTable } from "./log-table.js";
import type { QueryResultsBucket } from "./query-results-bucket.js";
import type { QueryWorkgroup } from "./query-workgroup.js";
import type { SummariesBucket } from "./summary-bucket.js";

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
 * Reading back the queries saved in one workgroup.
 *
 * `rainlytics saved-query` runs a rollup a site wrote for itself, and Athena
 * offers no way to ask for a saved query by name. `ListNamedQueries` hands
 * back ids and `BatchGetNamedQuery` turns them into names and SQL, so an
 * identity holding one without the other finds nothing to run.
 *
 * The scheduled job is the exception. It is handed its SQL at deploy time
 * and never looks a saved query up.
 */
export function savedQueryStatements(
  scope: Construct,
  workgroupName: string,
): readonly PolicyStatement[] {
  return [
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["athena:ListNamedQueries", "athena:BatchGetNamedQuery"],
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
 * Granted to a deployment whose questions count visitors, and left off one
 * whose table carries no viewer address. Nothing there can gain a visitor
 * count without redelivering the field, and the parameter is then one a site
 * running no count would have to create for a read that never happens.
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

/**
 * Writing a query's answer and reading it back.
 *
 * Athena writes every result to the workgroup's results location as whoever
 * started the query, and reads that object again to answer
 * `GetQueryResults`. So the caller writes to this bucket rather than Athena
 * writing on their behalf, and a role that can start a query but not put an
 * object fails at the moment the answer is ready.
 *
 * The multipart actions earn their place. Athena uploads a large result in
 * parts, so a role without them answers a small query and fails a big one.
 *
 * The grantee is taken as well as given a statement, for the reason
 * {@link logReadStatements} gives.
 */
export function resultsStatements(
  bucket: QueryResultsBucket,
  grantee: IGrantable,
): readonly PolicyStatement[] {
  bucket.encryptionKey?.grantDecrypt(grantee);

  return [
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: [
        "s3:PutObject",
        "s3:GetObject",
        "s3:GetBucketLocation",
        "s3:ListBucket",
        "s3:ListBucketMultipartUploads",
        "s3:ListMultipartUploadParts",
        "s3:AbortMultipartUpload",
      ],
      resources: [bucket.bucketArn, `${bucket.bucketArn}/*`],
    }),
  ];
}

/**
 * Reading a precomputed summary.
 *
 * One action on the objects, and nothing on the bucket. A reader builds the
 * key it wants from the question and the window, so nothing lists the prefix
 * and a listing would only be a slower way to arrive at the same key.
 *
 * The grantee is taken as well as given a statement, for the reason
 * {@link logReadStatements} gives. A site passing a bucket of its own under a
 * customer key is where that matters here, since the created bucket uses
 * S3-managed keys and has no key to grant.
 */
export function summaryReadStatements(
  bucket: SummariesBucket,
  grantee: IGrantable,
): readonly PolicyStatement[] {
  bucket.encryptionKey?.grantDecrypt(grantee);

  return [
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["s3:GetObject"],
      resources: [`${bucket.bucketArn}/*`],
    }),
  ];
}

/**
 * Reading the summaries that supply a calendar report.
 *
 * The report store recognises a missing key as an incomplete source. Amazon
 * S3 answers `GetObject` for a missing key with 403 when the caller lacks
 * `ListBucket`, and with 404 when it holds that permission:
 * https://docs.aws.amazon.com/AmazonS3/latest/API/API_GetObject.html
 *
 * The report builds every key itself and sends no list request. `ListBucket`
 * only lets S3 distinguish a missing object from a denied read.
 */
export function reportSourceReadStatements(
  bucket: SummariesBucket,
  grantee: IGrantable,
): readonly PolicyStatement[] {
  return [
    ...summaryReadStatements(bucket, grantee),
    new PolicyStatement({
      effect: Effect.ALLOW,
      actions: ["s3:ListBucket"],
      resources: [bucket.bucketArn],
    }),
  ];
}

/**
 * Everything the scheduled job's role is granted, in one list.
 *
 * Here rather than in `SummaryFunction` so that what the job may do is read
 * in one place, beside the statements saying what each part of it is for.
 *
 * The salt is the only conditional one. A deployment whose table carries no
 * viewer address counts no visitors, and granting it a read on a parameter
 * nobody created would describe a permission the site has to satisfy.
 */
export function summaryJobStatements(
  scope: Construct,
  granted: {
    readonly workgroup: QueryWorkgroup;
    readonly table: LogTable;
    readonly grantee: IGrantable;
    readonly saltParameter: string;
    readonly countsVisitors: boolean;
  },
): readonly PolicyStatement[] {
  return [
    ...athenaStatements(scope, granted.workgroup.workgroupName),
    ...catalogStatements(scope, granted.table.dataset),
    ...logReadStatements(granted.table.logBucket, granted.grantee),
    // Athena writes every query's output to the workgroup's results location
    // as the caller, and reads it back to answer GetQueryResults.
    ...resultsStatements(granted.workgroup.resultsBucket, granted.grantee),
    ...(granted.countsVisitors
      ? visitorSaltStatements(scope, granted.saltParameter)
      : []),
  ];
}
