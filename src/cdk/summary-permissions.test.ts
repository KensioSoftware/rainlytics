import { faker } from "@faker-js/faker";
import { Template } from "aws-cdk-lib/assertions";
import { Role, ServicePrincipal } from "aws-cdk-lib/aws-iam";
import { Key } from "aws-cdk-lib/aws-kms";
import { Bucket, BucketEncryption } from "aws-cdk-lib/aws-s3";
import { Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { defaultLogDataset } from "../dataset.js";
import {
  athenaStatements,
  catalogStatements,
  resultsStatements,
  savedQueryStatements,
  summaryReadStatements,
  visitorSaltStatements,
} from "./summary-permissions.js";

/*
 * The ARNs the job's role is allowed against, read off the statements. IAM is
 * the one part of this construct a simulated deployment cannot prove: a
 * malformed ARN denies at run time on real AWS and the query simply returns
 * nothing, which is what the end-to-end case would report as a quiet hour.
 */
describe("what the job is allowed to reach", () => {
  /*
   * The ARNs a statement names, with the partition taken off. CDK leaves that
   * as an unresolved token whose number depends on how many stacks the test
   * process has built, and it is not what these cases are about.
   */
  const resourcesOf = (
    statements: readonly { toStatementJson: () => unknown }[],
  ): readonly string[] =>
    statements
      .flatMap((statement) => {
        const written = statement.toStatementJson() as {
          Resource: string | string[];
        };

        return [written.Resource].flat();
      })
      .map((arn) => {
        const segments = arn.split(":");

        return ["arn", ...segments.slice(2)].join(":");
      });

  const inRegion = (): Stack =>
    new Stack(undefined, "AnalyticsStack", {
      env: { account: "123456789012", region: "eu-west-2" },
    });

  /** The actions a statement allows, in the order they were written. */
  const actionsOf = (
    statements: readonly { toStatementJson: () => unknown }[],
  ): readonly string[] =>
    statements.flatMap((statement) => {
      const written = statement.toStatementJson() as {
        Action: string | string[];
      };

      return [written.Action].flat();
    });

  /** A role standing in for whatever a site hands the grant. */
  const aReader = (stack: Stack): Role =>
    new Role(stack, `Reader${faker.string.alphanumeric(10)}`, {
      assumedBy: new ServicePrincipal("lambda.amazonaws.com"),
    });

  /**
   * Every action the identity policies in a stack allow.
   *
   * Read off the synthesised template rather than off the statements,
   * because a decrypt permission is handed out by the key rather than
   * returned, and the role is where the two meet.
   */
  const allowedIn = (stack: Stack): readonly string[] => {
    const policies = Template.fromStack(stack).findResources(
      "AWS::IAM::Policy",
    ) as Record<
      string,
      {
        Properties: {
          PolicyDocument: { Statement: { Action: string | string[] }[] };
        };
      }
    >;

    return Object.values(policies).flatMap((policy) =>
      policy.Properties.PolicyDocument.Statement.flatMap((statement) =>
        [statement.Action].flat(),
      ),
    );
  };

  it("names the catalog, the database and the table and nothing else", () => {
    // Given a job reading the default dataset.
    const stack = inRegion();

    // When the catalog statements are written.
    const resources = resourcesOf(catalogStatements(stack, defaultLogDataset));

    // Then the catalog's ARN ends at the word. A resource name of "" would
    // put a separator on the end, and Glue matches that shape against
    // nothing, so the job would be denied and the query would come back
    // empty.
    expect(resources).toStrictEqual([
      "arn:glue:eu-west-2:123456789012:catalog",
      "arn:glue:eu-west-2:123456789012:database/rainlytics",
      "arn:glue:eu-west-2:123456789012:table/rainlytics/cloudfront_logs",
    ]);
  });

  it("reads the one parameter the visitor salt is in", () => {
    // Given a deployment keeping its secret at the default name.
    const stack = inRegion();

    // When the salt statements are written.
    const statements = visitorSaltStatements(stack, "/rainlytics/visitor-salt");
    const actions = statements.flatMap(
      (statement) =>
        (statement.toStatementJson() as { Action: string[] }).Action,
    );

    // Then the job can read that parameter and nothing else. A parameter name
    // opens with a slash and its ARN does not repeat one, and an ARN carrying
    // two matches nothing.
    expect(actions).toStrictEqual(["ssm:GetParameter"]);
    expect(resourcesOf(statements)).toStrictEqual([
      "arn:ssm:eu-west-2:123456789012:parameter/rainlytics/visitor-salt",
    ]);
  });

  it("names a parameter a site chose for itself", () => {
    // Given a site whose secret lives somewhere of its own, written without a
    // leading slash.
    const statements = visitorSaltStatements(inRegion(), "mine/salt");

    // Then the ARN names it either way.
    expect(resourcesOf(statements)).toStrictEqual([
      "arn:ssm:eu-west-2:123456789012:parameter/mine/salt",
    ]);
  });

  it("runs queries in one workgroup and reads that workgroup's settings", () => {
    // Given a job running in a workgroup of its own.
    const stack = inRegion();

    // When the Athena statements are written.
    const statements = athenaStatements(stack, "rainlytics");
    const written = statements.map(
      (statement) => statement.toStatementJson() as { Action: string[] },
    );
    const actions = written.flatMap((each) => each.Action);

    // Then it can start, watch, stop and read one query, and read the
    // workgroup Athena refuses the query without.
    expect(actions).toContain("athena:StartQueryExecution");
    expect(actions).toContain("athena:GetWorkGroup");
    expect(resourcesOf(statements)).toStrictEqual([
      "arn:athena:eu-west-2:123456789012:workgroup/rainlytics",
    ]);
  });

  it("finds a saved query in the workgroup it would run in", () => {
    // Given a deployment holding rollups a site saved for itself.
    const stack = inRegion();

    // When the saved-query statements are written.
    const statements = savedQueryStatements(stack, "rainlytics");

    // Then both halves of the lookup are there. Athena answers
    // ListNamedQueries with ids and nothing else, so a role holding the list
    // without the batch read finds ids it cannot turn into a name or SQL.
    expect(actionsOf(statements)).toStrictEqual([
      "athena:ListNamedQueries",
      "athena:BatchGetNamedQuery",
    ]);
    expect(resourcesOf(statements)).toStrictEqual([
      "arn:athena:eu-west-2:123456789012:workgroup/rainlytics",
    ]);
  });

  it("writes a query's answer and reads it back off the results bucket", () => {
    // Given the bucket the workgroup sends results to.
    const stack = inRegion();
    const bucketName = `rainlytics-results-${faker.string.uuid()}`;
    // Named rather than created, because a bucket a stack owns carries its
    // ARN as an attribute of a resource that does not exist yet, and these
    // cases are about which ARN the statement names.
    const bucket = Bucket.fromBucketName(stack, "Results", bucketName);

    // When the results statements are written for whoever runs the query.
    const statements = resultsStatements(bucket, aReader(stack));
    const actions = actionsOf(statements);

    // Then the caller writes the object itself. Athena writes a result as
    // whoever started the query, so a role that can start one and not put an
    // object fails at the moment the answer is ready.
    expect(actions).toContain("s3:PutObject");
    // And a large answer, which Athena uploads in parts, can be finished or
    // abandoned. Without these a small query answers and a big one does not.
    expect(actions).toContain("s3:ListMultipartUploadParts");
    expect(actions).toContain("s3:AbortMultipartUpload");
    // And GetQueryResults reads the object back on the caller's behalf.
    expect(actions).toContain("s3:GetObject");
    expect(resourcesOf(statements)).toStrictEqual([
      `arn:s3:::${bucketName}`,
      `arn:s3:::${bucketName}/*`,
    ]);
  });

  it("reads a summary object without listing the bucket it is in", () => {
    // Given the bucket a deployment writes its summaries to.
    const stack = inRegion();
    const bucketName = `rainlytics-summaries-${faker.string.uuid()}`;
    const bucket = Bucket.fromBucketName(stack, "Summaries", bucketName);

    // When the summary read statements are written.
    const statements = summaryReadStatements(bucket, aReader(stack));

    // Then one action on the objects and nothing on the bucket. A reader
    // builds every key it wants out of the question and the window, so a
    // listing would only be a slower way to the same key.
    expect(actionsOf(statements)).toStrictEqual(["s3:GetObject"]);
    expect(resourcesOf(statements)).toStrictEqual([`arn:s3:::${bucketName}/*`]);
  });

  it("decrypts a summaries bucket a site keeps under its own key", () => {
    // Given a site whose summaries bucket is encrypted with a customer key
    // rather than with S3-managed encryption.
    const stack = inRegion();
    const bucket = new Bucket(stack, "Summaries", {
      encryption: BucketEncryption.KMS,
      encryptionKey: new Key(stack, "SummaryKey"),
    });
    const reader = aReader(stack);

    // When a reader is given the summary read statements.
    summaryReadStatements(bucket, reader);

    // Then it can decrypt what it reads. S3 answers a GetObject under a key
    // the caller cannot use with an AccessDenied from KMS, and the statement
    // above has nothing to say about that.
    expect(allowedIn(stack)).toContain("kms:Decrypt");
  });
});
