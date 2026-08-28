import { Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { defaultLogDataset } from "../dataset.js";
import {
  athenaStatements,
  catalogStatements,
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
});
