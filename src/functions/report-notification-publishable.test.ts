import {
  assertObjectEquals,
  assertStringIncludes,
  assertThrowsError,
} from "@kensio/smartass";

import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import { publishableReportNotification } from "./report-notification-publishable.js";

describe("checking a notification before SNS sees it", () => {
  it("passes a message SNS accepts through unchanged", () => {
    // Given a subject and body a site's message function wrote.
    const written = {
      subject: `Digest ${faker.date.recent().toISOString().slice(0, 10)}`,
      message: faker.lorem.paragraphs(3),
    };

    // When it is checked before publishing.
    const checked = publishableReportNotification(written, "manifest.json");

    // Then it is published as written.
    assertObjectEquals(checked, written);
  });

  it("counts a subject's characters rather than its UTF-16 code units", () => {
    // Given a 99-character subject made of characters outside the Basic
    // Multilingual Plane, which JavaScript stores as two code units each.
    const written = { subject: "\u{1F4C8}".repeat(99), message: "body" };

    // When it is checked before publishing.
    const checked = publishableReportNotification(written, "manifest.json");

    // Then it is within the limit and published as written.
    assertObjectEquals(checked, written);
  });

  it("names the manifest and the rule a refused message breaks", () => {
    // Given messages SNS would refuse with a bare InvalidParameter.
    const manifestKey = `report-notifications/v1/UTC/${faker.string.uuid()}.json`;
    const refused = [
      { subject: "", message: "body" },
      { subject: "x".repeat(100), message: "body" },
      { subject: "two\nlines", message: "body" },
      { subject: "Digest", message: "" },
      { subject: "Digest", message: "x".repeat(262_145) },
      { subject: "Digest" },
    ];

    // When each is checked, then each is refused with the manifest named.
    for (const notification of refused) {
      const error = assertThrowsError(() =>
        publishableReportNotification(
          notification as Parameters<typeof publishableReportNotification>[0],
          manifestKey,
        ),
      );
      assertStringIncludes(error.message, manifestKey);
    }
  });
});
