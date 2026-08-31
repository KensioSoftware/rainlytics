import {
  assertFalse,
  assertIdentical,
  assertInstanceOf,
  assertObjectEquals,
  assertSetSize,
  assertStringIncludes,
  assertStringNotIncludes,
  assertThrowsError,
  assertTrue,
} from "@kensio/smartass";
import { faker } from "@faker-js/faker";
import { describe, it } from "vitest";

import {
  defaultPartitionGranularity,
  type PartitionGranularity,
} from "./partition-keys.js";
import {
  deliverySuffixPath,
  partitionKeyNames,
  partitionLocationTemplate,
  partitionPrefix,
  partitionProjection,
  timePartitionKeyNames,
} from "./partitions.js";

describe("the S3 partition layout", () => {
  const granularities: readonly PartitionGranularity[] = ["hourly", "daily"];

  /** The `key` half of every `key=value` segment in a partition path. */
  const keyNamesIn = (path: string): readonly string[] =>
    path.split("/").map((segment) => segment.split("=")[0] ?? "");

  /**
   * The Hive key name AWS writes for each partition variable.
   *
   * Written out here so the invariant below is checked against AWS's
   * rendering and not against the same table the code under test reads.
   * Taken from the "Example paths to access logs" tables and the
   * "Hive-compatible file name format" example in the CloudFront standard
   * logging documentation.
   */
  const hiveKeyFor: Readonly<Record<string, string>> = {
    "{distributionid}": "distributionid",
    "{yyyy}": "year",
    "{MM}": "month",
    "{dd}": "day",
    "{HH}": "hour",
  };

  /**
   * The partition keys CloudFront derives from a suffix path, delivering
   * Hive-compatible paths.
   *
   * A variable AWS has no documented rendering for comes back as it went in,
   * which no key name matches.
   */
  const asCloudFrontWrites = (suffixPath: string): readonly string[] =>
    suffixPath.split("/").map((variable) => hiveKeyFor[variable] ?? variable);

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

      // When the two halves of the layout are rendered. The path CloudFront is
      // told to write under carries variables, so it is put through the same
      // substitution CloudFront applies to reach the keys it lands on.
      const written = asCloudFrontWrites(deliverySuffixPath(granularity));
      const read = keyNamesIn(partitionPrefix(address, granularity));

      // Then they name the same partition keys in the same order. This is the
      // agreement the whole module exists to hold. CloudFront writing under a
      // prefix Athena does not read fails silently at both ends.
      assertObjectEquals(read, written);
    },
  );

  it("leaves the Hive key names for CloudFront to write", () => {
    // Given the hourly layout, which uses every time variable there is.
    // When the delivery path is rendered.
    const written = deliverySuffixPath("hourly");

    // Then it carries the variables alone, spelled the way CloudFront spells
    // them. A typo here deploys and then writes a literal "{yyyy}" directory.
    assertIdentical(written, "{distributionid}/{yyyy}/{MM}/{dd}/{HH}");

    // And it writes none of the `key=` halves. CloudFront adds those itself
    // when the delivery is Hive-compatible, and CloudWatch Logs rejects a
    // suffix path that has already done it: "Provided suffixPath is invalid".
    assertStringNotIncludes(written, "=");
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
    // spelling produces a dataset Athena reads back as empty. The write side
    // settles this by its choice of variable, since CloudFront carries the
    // case of the variable into the key it writes.
    for (const name of [...asCloudFrontWrites(written), ...keyNamesIn(read)]) {
      assertIdentical(name, name.toLowerCase());
    }
    assertStringIncludes(written, "{distributionid}");
  });

  it("pads every component to the width partition projection expects", () => {
    // Given an instant in the first hours of a single-digit day and month.
    const at = new Date(Date.UTC(2026, 0, 5, 4, 30));

    // When the partition holding it is addressed.
    const read = partitionPrefix({ distributionId: "E1EXAMPLE1234", at });

    // Then each component carries the leading zero projection matches on.
    assertIdentical(
      read,
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
    assertStringIncludes(read, `year=${iso.slice(0, 4)}`);
    assertStringIncludes(read, `month=${iso.slice(5, 7)}`);
    assertStringIncludes(read, `day=${iso.slice(8, 10)}`);
    assertStringIncludes(read, `hour=${iso.slice(11, 13)}`);
  });

  it("drops the hour when partitioning daily, and keeps the rest", () => {
    // Given the daily layout.
    // When its time keys are listed.
    const daily = timePartitionKeyNames("daily");

    // Then it partitions to the day and no finer.
    assertObjectEquals(daily, ["year", "month", "day"]);
    assertObjectEquals(timePartitionKeyNames("hourly"), [
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
    assertIdentical(defaultPartitionGranularity, "hourly");
    assertIdentical(deliverySuffixPath(), deliverySuffixPath("hourly"));
  });

  it("refuses an invalid Date rather than addressing year=NaN", () => {
    // Given a Date that parsed from something that was never a date.
    const at = new Date(faker.lorem.word());

    // When the partition holding it is addressed.
    const addressing = (): string =>
      partitionPrefix({ distributionId: aDistributionId(), at });

    // Then it fails here, and not as a prefix on S3 that every later query
    // silently misses.
    assertInstanceOf(assertThrowsError(addressing), RangeError);
  });
});

describe("what Athena is told about the partitions", () => {
  const granularities: readonly PartitionGranularity[] = ["hourly", "daily"];

  const aScope = (): { firstYear: number; distributionIds: string[] } => ({
    firstYear: faker.number.int({ min: 2020, max: 2030 }),
    distributionIds: [
      `E${faker.string.alphanumeric({ length: 13, casing: "upper" })}`,
    ],
  });

  it.each(granularities)(
    "templates the path a reader would address (%s)",
    (granularity) => {
      // Given an instant, and the distribution its requests reached.
      const address = {
        distributionId: `E${faker.string.alphanumeric({ length: 13 })}`,
        at: faker.date.past(),
      };

      // When the template is filled in with that partition's values, the way
      // Athena fills it in from a projection.
      const values: Readonly<Record<string, string>> = Object.fromEntries(
        partitionPrefix(address, granularity)
          .split("/")
          .map((segment) => segment.split("=")),
      );
      const filled = partitionLocationTemplate(granularity).replaceAll(
        /\$\{(?<key>\w+)\}/gu,
        (_match, key: string) => values[key] ?? "",
      );

      // Then it comes out as the prefix that partition's objects sit under.
      // The template is where Athena looks for the data, so a template
      // disagreeing with the writer reads an empty prefix and answers no
      // rows.
      assertIdentical(filled, partitionPrefix(address, granularity));
    },
  );

  it.each(granularities)(
    "projects every key the layout carries, and no others (%s)",
    (granularity) => {
      // Given a dataset with a first year and a distribution in it.
      const scope = aScope();

      // When its projection is rendered.
      const projection = partitionProjection(scope, granularity);

      // Then projection is on, and each key declares the values it takes. A
      // key without a projection is what makes Athena refuse the whole
      // query, since a projected table has no other way to know.
      assertIdentical(projection["projection.enabled"], "true");
      for (const name of partitionKeyNames(granularity)) {
        assertFalse(projection[`projection.${name}.type`] === undefined);
      }

      // And nothing is projected that the writer never writes. A projected
      // key with no partition under it sends every query looking through
      // prefixes that hold nothing.
      const projected = new Set(
        Object.keys(projection)
          .filter((parameter) => parameter !== "projection.enabled")
          .map((parameter) => parameter.split(".")[1] ?? ""),
      );
      const partitionKeys = partitionKeyNames(granularity);
      assertSetSize(projected, partitionKeys.length);
      for (const partitionKey of partitionKeys) {
        assertTrue(projected.has(partitionKey));
      }
    },
  );

  it("writes Athena's own placeholder where each value goes", () => {
    // Given the hourly layout.
    // When its location template is rendered.
    // Then every segment carries the key and the placeholder Athena
    // substitutes. A literal `${year}` left in the path is a table reading a
    // prefix that never exists.
    assertIdentical(
      partitionLocationTemplate("hourly"),
      `distributionid=\${distributionid}/year=\${year}/month=\${month}` +
        `/day=\${day}/hour=\${hour}`,
    );
  });

  it("runs the years from the first one to now", () => {
    // Given a dataset whose first logs arrived in a known year.
    const scope = { ...aScope(), firstYear: 2026 };

    // When its projection is rendered.
    const projection = partitionProjection(scope);

    // Then the range is open at the top. A fixed end year is a table that
    // stops finding data on a New Year's Day, and nothing reports it.
    assertIdentical(projection["projection.year.range"], "2026,NOW");
  });

  it("names every distribution delivering into the dataset", () => {
    // Given three sites sharing one bucket.
    const distributionIds = ["E1AAAA", "E2BBBB", "E3CCCC"];

    // When the projection is rendered.
    const projection = partitionProjection({
      firstYear: 2026,
      distributionIds,
    });

    // Then the first partition key enumerates them. This is the one key
    // whose values no rule can work out.
    assertIdentical(projection["projection.distributionid.type"], "enum");
    assertIdentical(
      projection["projection.distributionid.values"],
      "E1AAAA,E2BBBB,E3CCCC",
    );
  });
});
