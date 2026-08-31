// Where the salt comes from, and how one day's is derived.
//
// The Lambda half of `visitor-identity.ts`. That module is text a browser can
// import, and this one reads a secret out of Systems Manager and takes an
// HMAC with `node:crypto`.
//
// One secret stands for the whole deployment and never rotates. The day being
// counted is what rotates, because it goes into the derivation below. So the
// salt of any past day is derivable from the same secret, which is what makes
// a re-run of a window write the count that was there before it, and what
// leaves a question about last month answerable.
//
// The SSM client is loaded when the job actually reads, for the reason
// `athena-query.ts` gives at length. The deployment package carries no SDK.

import { createHmac } from "node:crypto";
import type * as SSM from "@aws-sdk/client-ssm";

import type { SummaryWindow } from "../summary-windows.js";
import type { ReportPeriod } from "../report-periods.js";
import {
  reportVisitorSaltMessage,
  visitorSaltDay,
  visitorSaltMessage,
} from "../visitor-identity.js";

/**
 * The secret a deployment counts visitors under, read out of Parameter Store.
 *
 * A `SecureString` parameter, created outside CloudFormation because
 * CloudFormation cannot create one. `AWS::SSM::Parameter` writes `String` and
 * `StringList` and nothing else, and a construct that generated a secret at
 * synthesis would put it in the template where the whole point is that it is
 * not written down. `docs/visitors/` has the command that makes one.
 *
 * Read once per invocation and never cached across them. A run makes one
 * `GetParameter` call, standard-tier throughput is not charged for, and
 * decryption under the `aws/ssm` managed key costs three cents per ten
 * thousand calls.
 *
 * @throws {Error} naming the parameter and how to create it, where there is
 *   none. A run that carried on would count visitors under a salt it invented
 *   and write a number that no re-run could reproduce.
 */
export async function visitorSecret(parameter: string): Promise<string> {
  const ssm: typeof SSM = await import("@aws-sdk/client-ssm");
  const client = new ssm.SSMClient({});
  let found: SSM.GetParameterCommandOutput;

  try {
    found = await client.send(
      new ssm.GetParameterCommand({ Name: parameter, WithDecryption: true }),
    );
  } catch (error) {
    // Whatever SSM said, under the sentence that says which parameter was
    // wanted. `ParameterNotFound` on its own reads as a bare name, and a
    // scheduled job fails in a log group nobody is watching.
    throw refused(parameter, `could not be read (${thrownName(error)})`);
  } finally {
    client.destroy();
  }

  const value = found.Parameter?.Value ?? "";

  if (value.trim() === "") {
    throw refused(parameter, "holds nothing");
  }

  return value;
}

/**
 * The salt for the day a window falls in.
 *
 * An HMAC of the message `visitorSaltMessage` writes, keyed by the secret,
 * rendered as hex. HMAC and not a plain digest of the two joined together,
 * because a plain digest of a secret and a suffix is extensible and this is
 * the construction built to be keyed.
 *
 * A day's salt tells nobody the secret and nobody the next day's salt. That
 * matters because this value reaches Athena as literal text in a statement,
 * and Athena keeps 45 days of query history behind
 * `athena:GetQueryExecution`. CloudTrail omits the query string of
 * `StartQueryExecution` by design, and nothing writes the statement to S3. So
 * a salt read out of query history compromises the days it covers and no
 * others.
 */
export function visitorSalt(secret: string, window: SummaryWindow): string {
  return derivedSalt(secret, visitorSaltMessage(visitorSaltDay(window)));
}

/** The salt shared by every visitor row in one calendar report period. */
export function reportVisitorSalt(
  secret: string,
  period: ReportPeriod,
): string {
  return derivedSalt(secret, reportVisitorSaltMessage(period));
}

/** One keyed salt derived from a versioned scope message. */
function derivedSalt(secret: string, message: string): string {
  return createHmac("sha256", secret).update(message).digest("hex");
}

/** What a parameter this cannot count under is reported as. */
function refused(parameter: string, what: string): Error {
  return new Error(
    `The visitor salt secret ${what}. Rainlytics reads it from the SSM` +
      ` parameter "${parameter}". Create one with:\n` +
      `  aws ssm put-parameter --name ${parameter} --type SecureString` +
      ` --value "$(openssl rand -hex 32)"\n` +
      `See docs/visitors/ for what it is for and why nothing creates it for` +
      ` you.`,
  );
}

/** What SSM called the failure, or whatever was thrown where it named none. */
function thrownName(thrown: unknown): string {
  return thrown instanceof Error ? thrown.name : String(thrown);
}
