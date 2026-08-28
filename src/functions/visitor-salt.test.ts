import { SSMClient } from "@aws-sdk/client-ssm";
import { faker } from "@faker-js/faker";
import { SimAws, SimFixedClock } from "@kensio/yulin";
import { SimSdk } from "@kensio/yulin/sdk";
import { describe, expect, it } from "vitest";

import { simStartedAt } from "#test/simulated-deployment.js";

import type { SummaryWindow } from "../summary-windows.js";
import { defaultVisitorSaltParameter } from "../visitor-identity.js";
import { visitorSalt, visitorSecret } from "./visitor-salt.js";

describe("the secret a deployment counts visitors under", () => {
  let intercepted: SimSdk | undefined;

  /** A simulated account, with the SDK pointed at it. */
  const anAccount = (): SimAws => {
    const simAws = new SimAws({ clock: new SimFixedClock(simStartedAt) });

    // What the previous case in this file replaced, put back before this one
    // replaces it again.
    intercepted?.restoreAll();
    intercepted = new SimSdk({ simAws });
    intercepted.intercept(SSMClient);

    return simAws;
  };

  it("is read out of the parameter the construct pointed at", async () => {
    // Given a SecureString somebody put in Parameter Store, the way
    // `docs/visitors/` says to.
    const simAws = anAccount();
    const secret = faker.string.hexadecimal({ length: 64, prefix: "" });

    await simAws
      .region("us-east-1")
      .account()
      .ssm()
      .putParameter({
        input: {
          Name: defaultVisitorSaltParameter,
          Type: "SecureString",
          Value: secret,
        },
      });

    // Then the job reads it back decrypted.
    await expect(visitorSecret(defaultVisitorSaltParameter)).resolves.toBe(
      secret,
    );
  });

  it("refuses a deployment that has none, saying how to make one", async () => {
    // Given an account where nobody created the parameter.
    anAccount();

    // Then the run fails naming it and the command that creates one. A run
    // that invented a salt would write a count no re-run could reproduce.
    await expect(visitorSecret(defaultVisitorSaltParameter)).rejects.toThrow(
      defaultVisitorSaltParameter,
    );
    await expect(visitorSecret(defaultVisitorSaltParameter)).rejects.toThrow(
      /put-parameter/u,
    );
  });

  it("refuses a parameter holding nothing worth hashing under", async () => {
    // Given a parameter somebody created and left blank.
    const simAws = anAccount();

    await simAws
      .region("us-east-1")
      .account()
      .ssm()
      .putParameter({
        input: {
          Name: defaultVisitorSaltParameter,
          Type: "SecureString",
          Value: "   ",
        },
      });

    // Then it reads as a deployment with no secret. A salt keyed on
    // whitespace is a salt anybody can guess.
    await expect(visitorSecret(defaultVisitorSaltParameter)).rejects.toThrow(
      /holds nothing/u,
    );
  });
});

describe("the salt one day is counted under", () => {
  const aSecret = (): string =>
    faker.string.hexadecimal({ length: 64, prefix: "" });

  const anHourOn = (day: string, hour: number): SummaryWindow => ({
    granularity: "hourly",
    at: new Date(`${day}T${String(hour).padStart(2, "0")}:30:00.000Z`),
  });

  it("is the same however often the window is recomputed", () => {
    // Given one secret and one window, computed now and again next week.
    const secret = aSecret();
    const window = anHourOn("2026-08-23", 8);

    // Then both runs count under the same salt. KensioSoftware/rainlytics#54
    // is built on a re-run overwriting what was there, and a salt taken from
    // the clock would make the second run disagree with the first.
    expect(visitorSalt(secret, window)).toBe(visitorSalt(secret, window));
  });

  it("is the same for every window inside one day", () => {
    // Given the hours of a day and the day over them.
    const secret = aSecret();
    const hours = [0, 8, 23].map((hour) => anHourOn("2026-08-23", hour));
    const day: SummaryWindow = {
      granularity: "daily",
      at: new Date("2026-08-23T14:07:00.000Z"),
    };

    // Then all of them count the same identifiers, and a reader can see that
    // the hours of a day add up to more than the day because people came
    // back.
    for (const hour of hours) {
      expect(visitorSalt(secret, hour)).toBe(visitorSalt(secret, day));
    }
  });

  it("is a different one tomorrow", () => {
    // Given one secret and two consecutive days.
    const secret = aSecret();

    // Then the same visitor takes a different identifier tomorrow. This is
    // what `VisitorCount.additive` says in the document.
    expect(visitorSalt(secret, anHourOn("2026-08-23", 8))).not.toBe(
      visitorSalt(secret, anHourOn("2026-08-24", 8)),
    );
  });

  it("is a different one under a different secret", () => {
    // Given two deployments counting the same day.
    const window = anHourOn("2026-08-23", 8);

    // Then neither can reproduce the other's identifiers. A site that
    // replaced its secret is counting somebody new from that day on.
    expect(visitorSalt(aSecret(), window)).not.toBe(
      visitorSalt(aSecret(), window),
    );
  });

  it("says nothing about the secret it came from", () => {
    // Given a day's salt.
    const secret = aSecret();
    const salt = visitorSalt(secret, anHourOn("2026-08-23", 8));

    // Then it is a SHA-256 in hex and holds none of the secret. It reaches
    // Athena as literal text, and Athena keeps 45 days of query history.
    expect(salt).toMatch(/^[0-9a-f]{64}$/u);
    expect(salt).not.toContain(secret);
  });
});
