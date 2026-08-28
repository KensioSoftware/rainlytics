/**
 * A caller allowed to read Athena and to do nothing else, for the cases about
 * what a command says to whoever it cannot answer for.
 *
 * The refusal comes from simulated IAM applying a policy, so a case passes
 * because the permission is missing. An error pushed into the SDK would pass
 * whatever the command asked for.
 *
 * The role is created rather than assumed. Yulin attributes an operation to
 * the ambient `simAws.runAs` principal, and the policies that apply are the
 * ones on the identity it names.
 */

import { faker } from "@faker-js/faker";
import type { SimAws } from "@kensio/yulin";

/** A principal a simulated AWS can run as. */
export interface SimulatedCaller {
  readonly kind: "arn";
  readonly arn: string;
}

/**
 * The Athena an SSO read-only role carries.
 *
 * `ReadOnlyAccess` allows the whole of the service's reading and none of its
 * work. Listing the saved queries is on this side of the line, so
 * `rainlytics saved-query` finds its query and is refused at the query.
 *
 * The S3 that role carries is left off. A caller reaching a bucket it may not
 * read is a case of its own, and this is the identity it happens to.
 */
const readingAthena = [
  "athena:BatchGetNamedQuery",
  "athena:GetNamedQuery",
  "athena:GetQueryExecution",
  "athena:GetQueryResults",
  "athena:GetWorkGroup",
  "athena:ListNamedQueries",
  "athena:ListWorkGroups",
];

/** A role that may read Athena, under a name no other test is using. */
export async function readingAthenaCaller(
  simAws: SimAws,
): Promise<SimulatedCaller> {
  const account = simAws.account();
  const iam = account.iam();
  const roleName = `ReadOnly-${faker.string.uuid()}`;
  const created = await iam.createRole({
    input: {
      RoleName: roleName,
      AssumeRolePolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: "sts:AssumeRole",
            Principal: { AWS: `arn:aws:iam::${account.accountId}:root` },
          },
        ],
      }),
    },
  });

  await iam.putRolePolicy({
    input: {
      RoleName: roleName,
      PolicyName: "ReadingAthena",
      PolicyDocument: JSON.stringify({
        Version: "2012-10-17",
        Statement: [{ Effect: "Allow", Action: readingAthena, Resource: "*" }],
      }),
    },
  });

  return { kind: "arn", arn: created.Role.Arn };
}
