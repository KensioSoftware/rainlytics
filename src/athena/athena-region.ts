// Where a query was asked, and saying so when the answer was "not found".
//
// Shared by everything that builds an Athena client, because they all have
// the same problem to report. Athena names what it could not find and never
// where it looked.
//
// The region matters most to whoever reads the failure. A person at a
// terminal has a profile they can change, and a scheduled job has a stack
// somebody deployed to one region and a table in another.

import type { AthenaClient } from "./athena-outcome.js";
import { messageOf } from "../thrown-message.js";

/**
 * The region the client settled on, where it settled on one.
 *
 * Asked of the client rather than read off the command line. A run naming no
 * region still has to know where it went, and the client is what knows what
 * the chain answered.
 *
 * Asked after the send rather than before it, which is what keeps it free.
 * The SDK memoizes a region it resolved, so a client that has already sent
 * answers from memory. It memoizes a resolution that threw, and the chain
 * ends in an instance metadata lookup, so asking first would pay that
 * lookup's timeout twice on a machine configured with no region at all.
 *
 * The chain reads `AWS_REGION`, then the profile, then the instance the
 * command runs on. A chain answering none of those leaves this undefined,
 * and that case reports itself, since a client with no region refuses to
 * send.
 */
export async function resolvedRegion(
  client: AthenaClient,
): Promise<string | undefined> {
  try {
    return await client.config.region();
  } catch {
    return undefined;
  }
}

/**
 * What Athena refused, with the region it was asked in.
 *
 * Athena names what it could not find and never where it looked. A profile
 * defaulting elsewhere is told `WorkGroup rainlytics is not found.` about a
 * workgroup sitting in the region it meant, and the region is the missing
 * half of that sentence.
 *
 * Every refusal gets it, rather than the ones whose wording says something
 * was missing. Matching on a service's prose goes quiet the day the prose
 * changes, and credentials, permissions and endpoint failures are all worth
 * locating too.
 *
 * What the SDK threw is kept as the cause. A caller that tells one refusal
 * from another needs the error's name and the sentence it came with, and both
 * are gone by the time this has flattened them into a message.
 */
export function refusalIn(thrown: unknown, region: string | undefined): Error {
  const said = messageOf(thrown);

  return new Error(
    region === undefined
      ? said
      : `${said} Athena was asked in ${region}. Name another with --region.`,
    { cause: thrown },
  );
}
