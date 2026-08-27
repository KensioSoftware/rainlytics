import { gzipSync } from "node:zlib";

import { faker } from "@faker-js/faker";
import { Distribution } from "aws-cdk-lib/aws-cloudfront";
import { HttpOrigin } from "aws-cdk-lib/aws-cloudfront-origins";
import { Bucket } from "aws-cdk-lib/aws-s3";
import { App, CfnOutput, Stack } from "aws-cdk-lib/core";
import { describe, expect, it } from "vitest";

import { deployStacks, simStartedAt } from "#test/simulated-deployment.js";

import { defaultLogDataset, qualifiedTableName } from "../dataset.js";
import { deliveredLogColumnNames } from "../log-fields.js";
import {
  partitionKeyNames,
  partitionLocationTemplate,
  partitionPrefix,
} from "../partitions.js";
import {
  CloudFrontLogDelivery,
  type CloudFrontLogDeliveryProps,
} from "./log-delivery.js";
import { LogBucket } from "./log-bucket.js";
import { LogTable, type LogTableProps } from "./log-table.js";

describe("the Glue table over delivered logs", () => {
  /** What a deployed table's test needs to reach it afterwards. */
  interface DeployedTable {
    readonly simAws: Awaited<ReturnType<typeof deployStacks>>["simAws"];
    readonly logBucketName: string;
    readonly resultsBucketName: string;
    readonly distributionIds: readonly string[];
  }

  /**
   * A log bucket, one or more deliveries into it and a table over them,
   * deployed into a simulated account.
   *
   * The distributions are deployed rather than invented, for the reason
   * log-delivery.test.ts deploys one. A delivery source naming a distribution
   * that is not there is something AWS refuses.
   */
  const deployTable = async (
    options: {
      readonly distributions?: number;
      readonly delivery?: Partial<CloudFrontLogDeliveryProps>;
      readonly table?: Omit<Partial<LogTableProps>, "deliveries">;
    } = {},
  ): Promise<DeployedTable> => {
    const logBucketName = `rainlytics-logs-${faker.string.uuid()}`;
    const resultsBucketName = `rainlytics-results-${faker.string.uuid()}`;
    const count = options.distributions ?? 1;

    const { simAws, stacks } = await deployStacks(
      (app: App, account: string) => {
        const stack = new Stack(app, "AnalyticsStack", {
          env: { account, region: "us-east-1" },
        });

        const logs = new LogBucket(stack, "RainlyticsLogs", {
          bucketName: logBucketName,
        });
        // Where Athena writes what a query answered. The workgroup that
        // carries this in production is KensioSoftware/rainlytics#21.
        new Bucket(stack, "QueryResults", { bucketName: resultsBucketName });

        const deliveries = Array.from({ length: count }, (_unused, index) => {
          const distribution = new Distribution(stack, `Site${String(index)}`, {
            defaultBehavior: { origin: new HttpOrigin("origin.example.com") },
          });
          // The id is a token until the stack goes up, so the test reads it
          // back through an output rather than guessing what it resolved to.
          new CfnOutput(stack, `Distribution${String(index)}`, {
            value: distribution.distributionId,
          });

          return new CloudFrontLogDelivery(stack, `Delivery${String(index)}`, {
            ...options.delivery,
            distributionId: distribution.distributionId,
            logBucket: logs.bucket,
          });
        });

        new LogTable(stack, "RainlyticsTable", {
          ...options.table,
          deliveries,
        });
      },
    );

    const deployed = stacks.get("AnalyticsStack");

    return {
      simAws,
      logBucketName,
      resultsBucketName,
      distributionIds: Array.from({ length: count }, (_unused, index) =>
        String(deployed?.output(`Distribution${String(index)}`)),
      ),
    };
  };

  /** The table as the simulated Data Catalog holds it. */
  const catalogTable = ({ simAws }: DeployedTable) => {
    const table = simAws
      .region("us-east-1")
      .account()
      .glue()
      .findTable(defaultLogDataset.databaseName, defaultLogDataset.tableName);

    if (table === undefined) {
      throw new Error("The deployment left no table in the catalog.");
    }

    return table;
  };

  it("names the database and the table what a query will name them", async () => {
    // Given a delivery and a table over it.
    // When the stack is deployed.
    const deployed = await deployTable();

    // Then the catalog holds both, under the names `defaultLogDataset`
    // carries. The command line writes those same names into SQL, and
    // nothing else would catch the two drifting apart: a query naming a
    // table that does not exist reaches Athena, not a compiler.
    const glue = deployed.simAws.region("us-east-1").account().glue();
    expect(glue.findDatabase(defaultLogDataset.databaseName)?.name).toBe(
      "rainlytics",
    );
    expect(catalogTable(deployed).name).toBe("cloudfront_logs");
    expect(qualifiedTableName()).toBe('"rainlytics"."cloudfront_logs"');
  });

  it("declares a column for every field the delivery asks for", async () => {
    // Given a delivery taking the Rainlytics field set.
    // When the table over it is deployed.
    const table = catalogTable(await deployTable());

    // Then the columns are those fields, in the order they are delivered.
    expect(table.columns.map((column) => column.Name)).toStrictEqual([
      ...deliveredLogColumnNames,
    ]);

    // And every one is a string. CloudFront quotes every JSON value and
    // types every Parquet field as a nullable string, so a column declared
    // `bigint` over this data fails the query with HIVE_BAD_DATA.
    for (const column of table.columns) {
      expect(column.Type).toBe("string");
    }
  });

  it("reads the bucket and prefix the delivery writes into", async () => {
    // Given a delivery writing under its default prefix.
    const deployed = await deployTable();

    // When the table over it is deployed.
    const table = catalogTable(deployed);

    // Then it reads exactly there. A table pointed anywhere else answers
    // every query with no rows and reports success.
    expect(table.storageDescriptor?.Location).toBe(
      `s3://${deployed.logBucketName}/rainlytics/`,
    );
  });

  it("projects the partitions rather than registering them", async () => {
    // Given a delivery writing hourly Hive partitions.
    const deployed = await deployTable();

    // When the table over it is deployed.
    const table = catalogTable(deployed);

    // Then the five keys are declared in the order the path writes them.
    expect(table.partitionKeys.map((key) => key.Name)).toStrictEqual([
      ...partitionKeyNames("hourly"),
    ]);

    // And projection is on, so nothing has to register a partition and no
    // crawler has to run on a schedule to find one.
    expect(table.parameters["projection.enabled"]).toBe("true");
    expect(
      deployed.simAws
        .region("us-east-1")
        .account()
        .glue()
        .partitionsInTable(
          defaultLogDataset.databaseName,
          defaultLogDataset.tableName,
        ),
    ).toStrictEqual([]);
  });

  it("declares the values each partition key takes", async () => {
    // Given a delivery and its table.
    const table = catalogTable(await deployTable());

    // Then the year runs from the first year of any Rainlytics delivery to
    // now. It is the only key whose upper end moves.
    expect(table.parameters["projection.year.type"]).toBe("date");
    expect(table.parameters["projection.year.range"]).toBe("2026,NOW");
    expect(table.parameters["projection.year.format"]).toBe("yyyy");
  });

  it("pads a projected value the way CloudFront pads the key", async () => {
    // Given a delivery and its table.
    const table = catalogTable(await deployTable());

    // Then the time keys are whole numbers two digits wide. Athena matches a
    // projected value against the S3 key character for character, so a
    // projection producing `hour=4` reads nothing from `hour=04` and answers
    // no rows.
    expect(table.parameters["projection.month.range"]).toBe("1,12");
    expect(table.parameters["projection.month.digits"]).toBe("2");
    expect(table.parameters["projection.hour.range"]).toBe("0,23");
    expect(table.parameters["projection.hour.digits"]).toBe("2");
  });

  it("templates where each projected partition sits", async () => {
    // Given a delivery and its table.
    const deployed = await deployTable();

    // When the table is read back.
    const table = catalogTable(deployed);

    // Then the template is the layout's own rendering of itself, anchored at
    // the bucket and prefix the delivery writes into. Restating the path
    // here would give the layout a fourth definition to drift from, and
    // partitions.test.ts is where its spelling is pinned.
    expect(table.parameters["storage.location.template"]).toBe(
      `s3://${deployed.logBucketName}/rainlytics/${partitionLocationTemplate("hourly")}`,
    );
  });

  it("prunes a query to the partition it names", async () => {
    // Given two hours of delivered objects, one small and one large.
    const deployed = await deployTable();
    const [distributionId = ""] = deployed.distributionIds;
    const anHourIn = new Date(simStartedAt);
    anHourIn.setUTCHours(anHourIn.getUTCHours() + 1);

    const first = await putLogObject(deployed, distributionId, simStartedAt, 1);
    const second = await putLogObject(deployed, distributionId, anHourIn, 40);

    // When the same query is run with and without a predicate on the
    // partition keys.
    const everything = await queryScan(deployed, `SELECT * FROM ${table()}`);
    const oneHour = await queryScan(
      deployed,
      `SELECT * FROM ${table()} WHERE year = '2026' AND month = '08'` +
        ` AND day = '23' AND hour = '09'`,
    );

    // Then the unqualified query reads both hours and the qualified one
    // reads the hour it named. This is what projection is for, and it is
    // the difference between a query costing what its answer needs and a
    // query costing the whole dataset.
    expect(everything).toBe(first + second);
    expect(oneHour).toBe(first);
    expect(oneHour).toBeLessThan(everything);
  });

  it("reads back the records CloudFront actually delivered", async () => {
    // Given an object written the way a delivery writes one: gzipped JSON
    // lines, keyed by the Hive partition path, with CloudFront's own field
    // names inside. These are the two spellings a Glue column cannot have,
    // and the record carries them exactly as #9 read them off S3.
    const deployed = await deployTable();
    const [distributionId = ""] = deployed.distributionIds;
    await putDelivered(deployed, distributionId, simStartedAt, [
      {
        "timestamp(ms)": "1787793822795",
        "cs-uri-stem": "/liju/",
        "cs(Referer)": "-",
        "cs(User-Agent)": "Mozilla/5.0",
        "c-country": "GB",
        "c-ip": "203.0.113.7",
      },
    ]);
    await enableQueryEngine(deployed);

    // When a query selects those columns by the names the table declares.
    const answered = await queryRows(
      deployed,
      `SELECT cs_uri_stem, cs_referer, cs_user_agent, c_country, c_ip, hour` +
        ` FROM ${table()} WHERE year = '2026' AND month = '08'` +
        ` AND day = '23' AND hour = '09'`,
    );

    // Then the values come back. This is the whole table definition working
    // at once: the SerDe reads a gzipped object, `mapping.cs_referer` finds
    // `cs(Referer)` in the record, and the projection supplies the partition
    // column from the prefix rather than from the data, since no delivered
    // record carries the hour. `c_ip` comes back as the address it was
    // delivered as, which is what a visitor count is hashed from.
    expect(answered.rows).toStrictEqual([
      ["/liju/", "-", "Mozilla/5.0", "GB", "203.0.113.7", "09"],
    ]);

    // And the query engine answered rather than a declaration this test
    // wrote. Rows that a fixture happens to agree with look the same.
    expect(answered.answeredBy).toBe("engine");
  });

  it("prunes to one distribution where a bucket holds several", async () => {
    // Given two sites delivering into one bucket, which is what makes
    // `distributionid` the first partition key.
    const deployed = await deployTable({ distributions: 2 });
    const [mine = "", theirs = ""] = deployed.distributionIds;
    const ours = await putLogObject(deployed, mine, simStartedAt, 1);
    await putLogObject(deployed, theirs, simStartedAt, 40);

    // When a query names one of them.
    const scanned = await queryScan(
      deployed,
      `SELECT * FROM ${table()} WHERE distributionid = '${mine}'`,
    );

    // Then it reads that site's objects and leaves the other site's alone.
    expect(scanned).toBe(ours);

    // And the projection knows both, so a query naming neither still reads
    // both. An enum is what makes that possible without registering
    // anything.
    expect(
      catalogTable(deployed).parameters["projection.distributionid.values"],
    ).toBe(`${mine},${theirs}`);
  });

  it("points JSON columns at CloudFront's own field names", async () => {
    // Given a delivery writing JSON, which is the default.
    const table = catalogTable(await deployTable());

    // Then the SerDe is told which record key each column reads. A JSON
    // record carries `cs(Referer)` and Athena will not have a column called
    // that, so without the mapping the column is null on every row.
    const serde = table.storageDescriptor?.SerdeInfo;
    expect(serde?.SerializationLibrary).toBe(
      "org.openx.data.jsonserde.JsonSerDe",
    );
    expect(serde?.Parameters?.["mapping.cs_referer"]).toBe("cs(Referer)");
    expect(serde?.Parameters?.["mapping.cs_user_agent"]).toBe("cs(User-Agent)");
    expect(serde?.Parameters?.["mapping.timestamp_ms"]).toBe("timestamp(ms)");

    // And key matching is case sensitive, so those mapping values are the
    // record's own keys rather than a lowercased version of them.
    expect(serde?.Parameters?.["case.insensitive"]).toBe("FALSE");
  });

  it("reads Parquet under the names Parquet writes", async () => {
    // Given a delivery writing Parquet.
    const table = catalogTable(
      await deployTable({ delivery: { outputFormat: "parquet" } }),
    );

    // Then the table reads it with the Parquet SerDe.
    expect(table.storageDescriptor?.SerdeInfo?.SerializationLibrary).toBe(
      "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
    );
    expect(table.parameters["classification"]).toBe("parquet");

    // And the columns are the same names the JSON table uses. AWS mangles
    // every field name on the way into a Parquet file (`cs(Referer)` is
    // written `cs_Referer`), and lowercasing that is what Athena's reader
    // matches. One set of column names is what lets a rollup query be
    // written once for both formats.
    expect(table.columns.map((column) => column.Name)).toStrictEqual([
      ...deliveredLogColumnNames,
    ]);
    expect(table.columns.map((column) => column.Name)).toContain("cs_referer");
  });

  it("drops the hour when the delivery partitions daily", async () => {
    // Given a delivery writing a partition a day.
    const table = catalogTable(
      await deployTable({ delivery: { granularity: "daily" } }),
    );

    // Then the table projects the four keys that exist and no hour. A key
    // the writer never writes would project prefixes that hold nothing.
    expect(table.partitionKeys.map((key) => key.Name)).toStrictEqual([
      ...partitionKeyNames("daily"),
    ]);
    expect(table.parameters["projection.hour.type"]).toBeUndefined();
    expect(table.parameters["storage.location.template"]).not.toContain("hour");
  });

  it("covers only the fields a narrowed delivery asks for", async () => {
    // Given a site delivering less than the full Rainlytics set.
    const table = catalogTable(
      await deployTable({
        delivery: { fields: ["timestamp(ms)", "cs-uri-stem"] },
      }),
    );

    // Then the table describes that, rather than declaring columns for
    // fields nothing ever wrote.
    expect(table.columns.map((column) => column.Name)).toStrictEqual([
      "timestamp_ms",
      "cs_uri_stem",
    ]);
  });

  describe("what it refuses to build", () => {
    /** A stack holding a log bucket, a delivery and whatever a case adds. */
    const synthesise = (
      define: (stack: Stack, delivery: CloudFrontLogDelivery) => void,
      props: Partial<CloudFrontLogDeliveryProps> = {},
    ): void => {
      const stack = new Stack(new App(), "AnalyticsStack", {
        env: { account: "123456789012", region: "us-east-1" },
      });
      const logs = new LogBucket(stack, "RainlyticsLogs");
      const delivery = new CloudFrontLogDelivery(stack, "Delivery", {
        ...props,
        distributionId: aDistributionId(),
        logBucket: logs.bucket,
      });

      define(stack, delivery);
    };

    it("refuses a delivery format it has no reader for", () => {
      // Given a delivery writing one of CloudFront's text formats.
      // When a table is asked for over it.
      const building = (): void => {
        synthesise(
          (stack, delivery) => {
            new LogTable(stack, "Table", { deliveries: [delivery] });
          },
          { outputFormat: "w3c" },
        );
      };

      // Then it says so at synthesis. Guessing a SerDe would deploy a table
      // that scans the objects and answers nulls.
      expect(building).toThrow(/w3c/u);
      expect(building).toThrow(/json or parquet/u);
    });

    it("refuses deliveries that describe different datasets", () => {
      // Given two deliveries writing under different prefixes.
      const building = (): void => {
        synthesise((stack, delivery) => {
          const other = new CloudFrontLogDelivery(stack, "OtherDelivery", {
            distributionId: aDistributionId(),
            logBucket: new LogBucket(stack, "OtherLogs").bucket,
            prefix: "somewhere-else",
          });
          new LogTable(stack, "Table", { deliveries: [delivery, other] });
        });
      };

      // Then one table refuses to cover both. It could only cover one, and
      // the other site's logs would then be a bucket nothing reads.
      expect(building).toThrow(/the log bucket/u);
    });

    it("refuses to build a table over nothing", () => {
      // Given no deliveries at all.
      const building = (): void => {
        synthesise((stack) => {
          new LogTable(stack, "Table", { deliveries: [] });
        });
      };

      // Then there is nothing to describe, and it says so rather than
      // deploying a table with no location.
      expect(building).toThrow(/at least one delivery/u);
    });

    it("refuses a name a query would have to escape", () => {
      // Given a database named the way a person would name a folder.
      const building = (): void => {
        synthesise((stack, delivery) => {
          new LogTable(stack, "Table", {
            deliveries: [delivery],
            databaseName: "Rainlytics Logs",
          });
        });
      };

      // Then it refuses. Glue would take the name and Athena would lowercase
      // it, leaving the caller to work out what to type.
      expect(building).toThrow(/Rainlytics Logs/u);
    });

    it("refuses a field it has no Parquet spelling for", () => {
      // Given a delivery asking for a field Rainlytics does not declare.
      const building = (): void => {
        synthesise(
          (stack, delivery) => {
            new LogTable(stack, "Table", { deliveries: [delivery] });
          },
          { fields: ["timestamp(ms)", "x-edge-request-id"] },
        );
      };

      // Then no column is invented for it. The rule that turns a CloudFront
      // field name into a Parquet one is inferred from eleven observations,
      // and a guess that came out wrong would be a column of nulls under a
      // query reporting success.
      expect(building).toThrow(/x-edge-request-id/u);
    });
  });

  const aDistributionId = (): string =>
    `E${faker.string.alphanumeric({ length: 13, casing: "upper" })}`;

  const table = (): string => qualifiedTableName();

  /**
   * One delivered object in the partition an instant belongs to, sized so
   * that a test can tell which partitions a query read.
   *
   * The key is the one CloudFront writes, being the delivery prefix, the
   * Hive partition path and an object name. Returns its size in bytes.
   */
  const putLogObject = async (
    deployed: DeployedTable,
    distributionId: string,
    at: Date,
    records: number,
  ): Promise<number> =>
    putDelivered(
      deployed,
      distributionId,
      at,
      Array.from({ length: records }, () => ({ "c-country": "GB" })),
    );

  /**
   * One delivered object holding these records, written the way CloudFront
   * writes one.
   *
   * Gzipped JSON lines under the delivery prefix and the Hive partition path,
   * with CloudFront's own field names as the keys. Returns the object's size
   * in bytes, which is what a query scanning it is billed for.
   */
  const putDelivered = async (
    deployed: DeployedTable,
    distributionId: string,
    at: Date,
    records: readonly Readonly<Record<string, string>>[],
  ): Promise<number> => {
    const body = gzipSync(
      records.map((record) => JSON.stringify(record)).join("\n"),
    );

    await deployed.simAws
      .region("us-east-1")
      .account()
      .s3()
      .putObject({
        input: {
          Bucket: deployed.logBucketName,
          Key:
            `rainlytics/${partitionPrefix({ distributionId, at })}` +
            `/${distributionId}.${String(at.getTime())}.gz`,
          Body: body,
        },
      });

    return body.byteLength;
  };

  /**
   * Turns the query engine on for this simulation.
   *
   * Off by default in Yulin, and it loads `node-sql-parser` when it goes on.
   * Every other case here reads the catalog or measures a scan, neither of
   * which runs a query, so this is asked for where it is wanted.
   */
  const enableQueryEngine = async (deployed: DeployedTable): Promise<void> => {
    await deployed.simAws
      .region("us-east-1")
      .account()
      .athena()
      .engine()
      .enable();
  };

  /**
   * The rows one query answered with, and what answered it.
   *
   * The first row Athena returns is the column names, which is a header
   * rather than data, so it is dropped here.
   */
  const queryRows = async (
    deployed: DeployedTable,
    queryString: string,
  ): Promise<{
    readonly rows: readonly (readonly (string | undefined)[])[];
    readonly answeredBy: string | undefined;
  }> => {
    const athena = deployed.simAws.region("us-east-1").account().athena();
    const started = await athena.startQueryExecution({
      input: {
        QueryString: queryString,
        QueryExecutionContext: { Database: defaultLogDataset.databaseName },
        ResultConfiguration: {
          OutputLocation: `s3://${deployed.resultsBucketName}/queries/`,
        },
      },
    });
    await deployed.simAws.backgroundTasksComplete();

    const id = started.QueryExecutionId ?? "";
    const results = await athena.getQueryResults({
      input: { QueryExecutionId: id },
    });
    const execution = athena
      .queryExecutions()
      .find((each) => each.queryExecutionId === id);

    if (execution?.state !== "SUCCEEDED") {
      throw new Error(
        `The query did not succeed, so its rows prove nothing. ${
          execution?.stateChangeReason ?? "No reason was given."
        }`,
      );
    }

    return {
      rows: (results.ResultSet?.Rows ?? [])
        .slice(1)
        .map((row) => (row.Data ?? []).map((cell) => cell.VarCharValue)),
      answeredBy: execution.answeredBy,
    };
  };

  /**
   * How many bytes one query scanned.
   *
   * The query has to succeed for the figure to mean anything, so this
   * insists on it. A query that failed still reports what it scanned, and a
   * table Athena could not resolve would otherwise look like perfect
   * pruning.
   */
  const queryScan = async (
    deployed: DeployedTable,
    queryString: string,
  ): Promise<number> => {
    const athena = deployed.simAws.region("us-east-1").account().athena();
    const started = await athena.startQueryExecution({
      input: {
        QueryString: queryString,
        QueryExecutionContext: { Database: defaultLogDataset.databaseName },
        ResultConfiguration: {
          OutputLocation: `s3://${deployed.resultsBucketName}/queries/`,
        },
      },
    });
    await deployed.simAws.backgroundTasksComplete();

    const described = await athena.getQueryExecution({
      input: { QueryExecutionId: started.QueryExecutionId ?? "" },
    });
    const status = described.QueryExecution?.Status;

    if (status?.State !== "SUCCEEDED") {
      throw new Error(
        `The query did not succeed, so what it scanned proves nothing.` +
          ` ${status?.StateChangeReason ?? "No reason was given."}`,
      );
    }

    return described.QueryExecution?.Statistics?.DataScannedInBytes ?? -1;
  };
});
