// What stands for one visitor, and the salt that keeps it to one day.
//
// Text alone, with no Node built-in anywhere in it. The package root exports
// this module and browser code imports the package root.
// `functions/visitor-salt.ts` reads the secret and derives the day's salt,
// and that half runs on Lambda.
//
// KensioSoftware/rainlytics#53 chose a hash of the viewer address over a
// beacon identifier and over counting nothing at all. #74 is where the hash
// was written. `docs/visitors/` has what the count means, what cannot be
// added up, and why the salt lives where it does.

import { quoted } from "./sql-text.js";
import type { SummaryWindow } from "./summary-windows.js";
import { summarySpan } from "./summary-windows.js";

/**
 * What a query written before the salt is known carries where the salt goes.
 *
 * Invalid SQL, deliberately, for the reason `windowPlaceholder` is. A
 * template that reached Athena still holding this is refused before it reads
 * anything.
 *
 * It sits outside the quotes and {@link saltedSql} writes a quoted literal
 * over the whole of it. Inside them this would be valid SQL, and an unfilled
 * query would run and count every visitor of every day under one salt
 * spelled `${rainlytics_visitor_salt}`.
 *
 * The placeholder is also what keeps the salt out of the CloudFormation
 * template and out of a schedule's target input. Both hold the query text as
 * it was written at synthesis, and the salt reaches the statement in the
 * moment before it is sent.
 */
// oxlint-disable-next-line eslint/no-template-curly-in-string
export const visitorSaltPlaceholder = "${rainlytics_visitor_salt}";

/**
 * The text one visitor's identifier is the digest of.
 *
 * The day's salt, the viewer address and the user agent. The address is what
 * says two requests came from the same place, the user agent separates the
 * people behind one household address, and the salt is what stops the digest
 * over them being reversible by anybody who reads one.
 *
 * The three parts are joined by `|`, which an address cannot contain. So the
 * text hashed for one address and user agent belongs to that pair alone, and
 * a user agent starting with a pipe cannot borrow a digit from the address in
 * front of it.
 *
 * A record with no address never reaches this. `visitorRows` leaves it out,
 * which is where the days before KensioSoftware/rainlytics#73 delivered
 * `c-ip` go. Counting them would put every record of those days under one
 * identifier and report a visitor nobody was.
 */
export const visitorText = `concat(${visitorSaltPlaceholder}, '|', c_ip, '|', cs_user_agent)`;

/**
 * The identifier standing for one visitor, as Athena computes it.
 *
 * A SHA-256 of {@link visitorText}, in hex. The digest is what makes the
 * address unreadable, and the text under it is what makes two visitors two
 * identifiers.
 *
 * `sha256` and not `xxhash64`. Both are in Athena engine version 3, and
 * xxhash64 is faster and forgeable by anybody holding a digest. The volumes
 * here make the speed immaterial.
 *
 * Nothing stores one of these. `visitor-counts.ts` counts the distinct
 * digests of a window and Athena answers with the number.
 */
export const visitorIdentifier = `to_hex(sha256(to_utf8(${visitorText})))`;

/**
 * The SSM parameter holding the salt secret, where nobody chooses otherwise.
 *
 * One parameter per deployment. A second Rainlytics deployment in the same
 * account that wants its own visitors counted separately names its own, the
 * way it names its own schedule prefix and workgroup.
 */
export const defaultVisitorSaltParameter = "/rainlytics/visitor-salt";

/**
 * The day whose salt a window is counted under, as `YYYY-MM-DD` in UTC.
 *
 * Taken from the window and never from the clock. A window recomputed a week
 * later derives the salt of the day it covers, and writes the same count over
 * the one that was there. KensioSoftware/rainlytics#54 is built on a re-run
 * overwriting, and a run that hashed under today's salt would answer a
 * different number every time it went round.
 *
 * An hour takes the salt of the day holding it. The 24 hourly summaries of a
 * day and the daily summary of it are then counting the same identifiers, and
 * a reader can see that the hours of a day add up to more than the day
 * because people came back.
 */
export function visitorSaltDay(window: SummaryWindow): string {
  return summarySpan(window).from.slice(0, 10);
}

/**
 * What the day's salt is derived over.
 *
 * The scheme is named and numbered in the message itself. A change to how an
 * identifier is built gives the number a bump, and every past day then
 * derives the salt it was counted under. Without it a scheme change would
 * make a re-run of last month disagree with the summary already in the
 * bucket, silently and for one day only.
 *
 * `functions/visitor-salt.ts` takes the HMAC. This is the message half, and
 * it is here so that the day and the message it produces stay together.
 */
export function visitorSaltMessage(day: string): string {
  return `rainlytics/visitor-salt/1/${day}`;
}

/**
 * One query with the day's salt written into it.
 *
 * The salt arrives as a SQL literal with every quote in it doubled, so a
 * secret holding one cannot end the string it is in.
 *
 * @throws {Error} for a template carrying no placeholder. Such a query is
 *   either not a visitor count or one whose salt has already been filled in,
 *   and running it again would count a second window under the first one's
 *   salt.
 */
export function saltedSql(template: string, salt: string): string {
  if (!template.includes(visitorSaltPlaceholder)) {
    throw new Error(
      `A visitor count has to say which day's salt it counts under, and this` +
        ` query carries no ${visitorSaltPlaceholder}. Build it with` +
        ` visitorCountSql.`,
    );
  }

  return template.replaceAll(visitorSaltPlaceholder, quoted(salt));
}
