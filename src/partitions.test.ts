import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import {
  defaultPartitionGranularity,
  type PartitionGranularity,
} from "./partition-keys.js";
import {
  deliverySuffixPath,
  partitionPrefix,
  timePartitionKeyNames,
} from "./partitions.js";

describe("the S3 partition layout", () => {
  const granularities: readonly PartitionGranularity[] = ["hourly", "daily"];

  /** The `key` half of every `key=value` segment in a partition path. */
  const keyNamesIn = (path: string): readonly string[] =>
    path.split("/").map((segment) => segment.split("=")[0] ?? "");

  const aDistributionId = (): string =>
    `E${faker.string.alphanumeric({ length: 13, casing: "upper" })}`;

  it.each(granularities)(
    "writes and reads the same keys in the same order (%s)",
    (granularity) => {
      // Given an instant, and the distribution its requests reached.
      const address = {
        distributionId: aDistributionId(),
        at: faker.date.past(),
      };

      // When the two halves of the layout are rendered: the path CloudFront is
      // told to write under, and the prefix a reader addresses.
      const written = deliverySuffixPath(granularity);
      const read = partitionPrefix(address, granularity);

      // Then they name the same partition keys in the same order. This is the
      // agreement the whole module exists to hold. CloudFront writing under a
      // prefix Athena does not read fails silently at both ends.
      expect(keyNamesIn(read)).toStrictEqual(keyNamesIn(written));
    },
  );

  it("leaves CloudFront's variables in the path CloudFront fills in", () => {
    // Given the hourly layout, which uses every time variable there is.
    // When the delivery path is rendered.
    const written = deliverySuffixPath("hourly");

    // Then it carries the variable names CloudFront substitutes, spelled the
    // way CloudFront spells them. A typo here deploys and then writes a
    // literal "{yyyy}" directory.
    expect(written).toBe(
      "distributionid={distributionid}/year={yyyy}/month={MM}/day={dd}/hour={HH}",
    );
  });

  it("uses lowercase key names, which is what Glue reads", () => {
    // Given either half of the layout.
    const written = deliverySuffixPath("hourly");
    const read = partitionPrefix(
      { distributionId: aDistributionId(), at: faker.date.past() },
      "hourly",
    );

    // Then no key name carries a capital. Glue expects lowercase partition
    // names, and CloudFront offers `{DistributionId}` as well, so the other
    // spelling produces a dataset Athena reads back as empty.
    for (const name of [...keyNamesIn(written), ...keyNamesIn(read)]) {
      expect(name).toBe(name.toLowerCase());
    }
  });

  it("pads every component to the width partition projection expects", () => {
    // Given an instant in the first hours of a single-digit day and month.
    const at = new Date(Date.UTC(2026, 0, 5, 4, 30));

    // When the partition holding it is addressed.
    const read = partitionPrefix({ distributionId: "E1EXAMPLE1234", at });

    // Then each component carries the leading zero projection matches on.
    expect(read).toBe(
      "distributionid=E1EXAMPLE1234/year=2026/month=01/day=05/hour=04",
    );
  });

  it("names the UTC components of the instant it covers", () => {
    // Given any instant in the range a log dataset plausibly spans.
    const at = faker.date.between({
      from: "2020-01-01T00:00:00Z",
      to: "2035-01-01T00:00:00Z",
    });

    // When the partition holding it is addressed.
    const read = partitionPrefix({ distributionId: "E1EXAMPLE1234", at });

    // Then its components are the ones ISO 8601 gives, which is a different
    // route to them than the one under test.
    const iso = at.toISOString();
    expect(read).toContain(`year=${iso.slice(0, 4)}`);
    expect(read).toContain(`month=${iso.slice(5, 7)}`);
    expect(read).toContain(`day=${iso.slice(8, 10)}`);
    expect(read).toContain(`hour=${iso.slice(11, 13)}`);
  });

  it("drops the hour when partitioning daily, and keeps the rest", () => {
    // Given the daily layout.
    // When its time keys are listed.
    const daily = timePartitionKeyNames("daily");

    // Then it partitions to the day and no finer.
    expect(daily).toStrictEqual(["year", "month", "day"]);
    expect(timePartitionKeyNames("hourly")).toStrictEqual([
      "year",
      "month",
      "day",
      "hour",
    ]);
  });

  it("partitions hourly unless told otherwise", () => {
    // Given no granularity, which is what a consumer taking the default gets.
    // Then it is the hourly layout, which is the one that keeps a rollup able
    // to read one hour without rereading the hours before it.
    expect(defaultPartitionGranularity).toBe("hourly");
    expect(deliverySuffixPath()).toBe(deliverySuffixPath("hourly"));
  });

  it("refuses an invalid Date rather than addressing year=NaN", () => {
    // Given a Date that parsed from something that was never a date.
    const at = new Date(faker.lorem.word());

    // When the partition holding it is addressed.
    const addressing = (): string =>
      partitionPrefix({ distributionId: aDistributionId(), at });

    // Then it fails here, and not as a prefix on S3 that every later query
    // silently misses.
    expect(addressing).toThrow(RangeError);
  });
});
