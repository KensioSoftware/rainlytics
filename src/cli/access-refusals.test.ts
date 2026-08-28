import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { refusalIn } from "../athena/athena-region.js";
import { cannotRunQueries, isDenied } from "./access-refusals.js";

/*
 * What a refusal is recognised by, in the one case the simulation cannot
 * produce.
 *
 * The commands are covered where they run. `query-command.test.ts`,
 * `saved-query-command.test.ts`, `rollup-commands.test.ts` and
 * `summary-covering.test.ts` each refuse a real caller through simulated IAM
 * and read what came back.
 *
 * Simulated AWS names every refusal `AccessDenied`. That is what S3 answers
 * and what those cases meet. Athena answers `AccessDeniedException`, and this
 * is where that name is covered.
 */
describe("a refusal AWS gives for want of a permission", () => {
  it("is recognised under the name Athena gives it", () => {
    // Given what Athena throws at an identity missing the action, wrapped
    // the way a query that could not start wraps it.
    const said =
      `User: arn:aws:sts::${faker.string.numeric(12)}:assumed-role/Reader is` +
      ` not authorized to perform: athena:StartQueryExecution`;
    const refusal = refusalIn(
      Object.assign(new Error(said), { name: "AccessDeniedException" }),
      "eu-west-1",
    );

    // Then it is known for what it is, through the wrapper.
    expect(isDenied(refusal)).toBe(true);

    // And the message keeps what Athena said and drops the region. The
    // region is the one thing about this failure that was already right.
    const explained = cannotRunQueries(refusal, "rainlytics").message;

    expect(explained).toContain(said);
    expect(explained).toContain("athena:StopQueryExecution");
    expect(explained).not.toContain("eu-west-1");
  });

  it("is not claimed for a refusal about something else", () => {
    // Given a query refused for naming a table nobody created.
    const thrown = new Error(`Table ${faker.database.column()} not found`);
    const refusal = refusalIn(
      Object.assign(thrown, { name: "InvalidRequestException" }),
      "eu-west-1",
    );

    // Then nothing here recognises it, so it keeps the region sentence and
    // reaches the reader as Athena wrote it. A policy to write is the wrong
    // thing to hand somebody whose table name is wrong.
    expect(isDenied(refusal)).toBe(false);
    expect(refusal.message).toContain("Athena was asked in eu-west-1");
  });
});
