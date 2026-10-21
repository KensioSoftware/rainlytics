// Reading `--bot-user-agent` as the substrings a request adds to the bot
// filter.
//
// Beside `option-values.ts` and written the same way. It takes what the option
// collected and refuses a substring no logged user agent could contain before
// anything reaches Athena.

import { isBotUserAgent } from "../bot-filter.js";
import type { OptionValue } from "./command-line.js";
import { UsageError } from "./failure.js";
import { eachChosen } from "./option-values.js";

/**
 * The substrings `--bot-user-agent` added to the bot filter, in lower case.
 *
 * Folded here as the filter folds them, so that a summary computed for
 * `GeedoShopProductFinder` answers a command line typing it in lower case.
 *
 * @throws {UsageError} for an empty one, which every user agent contains,
 *   and for one holding a space, which CloudFront logs as `%20` and which
 *   would therefore match nothing.
 */
export function botUserAgentsFrom(
  value: OptionValue,
  command: string,
): readonly string[] {
  const agents = eachChosen(value).map((agent) => agent.trim().toLowerCase());

  const refused = agents.find((agent) => !isBotUserAgent(agent));

  if (refused !== undefined) {
    throw new UsageError(
      `--bot-user-agent takes one run of a user agent with no spaces, as in` +
        ` productfinder. Got "${refused}".`,
      command,
    );
  }

  return agents;
}
