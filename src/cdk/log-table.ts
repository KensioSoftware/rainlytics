import { CfnDatabase, CfnTable } from "aws-cdk-lib/aws-glue";
import { Stack } from "aws-cdk-lib/core";
import { Construct } from "constructs";

import {
  assertQueryableName,
  defaultLogDataset,
  type LogDataset,
} from "../dataset.js";
import { deliveredLogFieldsNamed, logColumnName } from "../log-fields.js";
import { defaultFirstPartitionYear } from "../partition-keys.js";
import {
  partitionKeyNames,
  partitionLocationTemplate,
  partitionProjection,
} from "../partitions.js";
import type { LogDeliveryBucket } from "./delivery-bucket.js";
import type { CloudFrontLogDelivery } from "./log-delivery.js";
import { agreedDelivery } from "./log-table-deliveries.js";
import { logTableFormat } from "./log-table-format.js";

/** What a Rainlytics log table needs telling. */
export interface LogTableProps {
  /**
   * The deliveries writing the objects this table describes.
   *
   * The table is built from these rather than from a bucket and a format
   * given again here. A table and a delivery that disagree produce the
   * failure this construct exists to avoid, and two literals that happen to
   * match today are how they come to disagree.
   *
   * Several deliveries can share one table, and a bucket receiving three
   * sites' logs is the case that makes `distributionid` the first partition
   * key. They have to agree about the bucket, the prefix, the output format,
   * the granularity and the field set, since one table describes one dataset.
   */
  readonly deliveries: readonly CloudFrontLogDelivery[];

  /**
   * The Glue database the table goes in.
   *
   * @default {@link defaultLogDataset}
   */
  readonly databaseName?: string | undefined;

  /**
   * The table's name.
   *
   * @default {@link defaultLogDataset}
   */
  readonly tableName?: string | undefined;

  /**
   * The earliest year the projection covers.
   *
   * Raise it to the year the delivery started on a site set up later. Every
   * year in the range is expanded on every query that names no year, and
   * years before the data cost planning time and find nothing.
   *
   * @default {@link defaultFirstPartitionYear}
   */
  readonly firstYear?: number | undefined;

  /**
   * What the database is for, as the Glue console shows it.
   *
   * @default a sentence naming Rainlytics
   */
  readonly databaseDescription?: string | undefined;
}

/**
 * A Glue database and table over delivered CloudFront logs, with the
 * partitions projected.
 *
 * ```typescript
 * const logs = new LogBucket(this, "RainlyticsLogs");
 * const delivery = new CloudFrontLogDelivery(this, "RainlyticsDelivery", {
 *   distributionId: "E1EXAMPLE1234",
 *   logBucket: logs.bucket,
 * });
 *
 * new LogTable(this, "RainlyticsTable", { deliveries: [delivery] });
 * ```
 *
 * Nothing registers a partition and nothing crawls the bucket. Athena works
 * out which prefixes a query reads from the partition values the table
 * declares, so a query covering one hour reads one hour's objects and is
 * billed for those bytes. A query naming no partition reads the lot.
 *
 * The table describes what the deliveries were configured with. Its columns
 * are their fields, its location is their bucket and prefix, and its SerDe is
 * whatever reads their output format.
 */
export class LogTable extends Construct {
  /** The Glue database holding the table. */
  readonly database: CfnDatabase;

  /** The table itself. */
  readonly table: CfnTable;

  /** What a query calls the two. */
  readonly dataset: LogDataset;

  /** Where the table reads from, being the bucket and the delivery prefix. */
  readonly location: string;

  /**
   * The bucket holding the objects, as the deliveries agreed on it.
   *
   * Here because whatever queries the table has to be allowed to read what is
   * under it. Athena reads the objects as whoever ran the query, so a
   * scheduled job needs the bucket rather than only the `s3://` location the
   * table declares.
   */
  readonly logBucket: LogDeliveryBucket;

  constructor(scope: Construct, id: string, props: LogTableProps) {
    super(scope, id);

    const delivery = agreedDelivery(props.deliveries);
    const catalogId = Stack.of(this).account;

    this.dataset = {
      databaseName: props.databaseName ?? defaultLogDataset.databaseName,
      tableName: props.tableName ?? defaultLogDataset.tableName,
    };
    assertQueryableName("database", this.dataset.databaseName);
    assertQueryableName("table", this.dataset.tableName);

    this.logBucket = delivery.logBucket;
    this.location = `s3://${delivery.logBucket.bucketName}/${delivery.prefix}/`;

    const fields = deliveredLogFieldsNamed(delivery.fields);
    const format = logTableFormat(delivery.outputFormat, fields);

    this.database = new CfnDatabase(this, "Database", {
      catalogId,
      databaseInput: {
        name: this.dataset.databaseName,
        description:
          props.databaseDescription ??
          "CloudFront access logs collected by Rainlytics.",
      },
    });

    this.table = new CfnTable(this, "Table", {
      catalogId,
      databaseName: this.dataset.databaseName,
      tableInput: {
        name: this.dataset.tableName,
        description: `CloudFront access logs delivered to ${this.location}`,
        tableType: "EXTERNAL_TABLE",
        parameters: {
          EXTERNAL: "TRUE",
          classification: format.classification,
          "storage.location.template":
            this.location + partitionLocationTemplate(delivery.granularity),
          ...partitionProjection(
            {
              firstYear: props.firstYear ?? defaultFirstPartitionYear,
              distributionIds: props.deliveries.map(
                (each) => each.distributionId,
              ),
            },
            delivery.granularity,
          ),
        },
        partitionKeys: partitionKeyNames(delivery.granularity).map((name) => ({
          name,
          type: "string",
        })),
        storageDescriptor: {
          location: this.location,
          inputFormat: format.inputFormat,
          outputFormat: format.outputFormat,
          serdeInfo: {
            serializationLibrary: format.serializationLibrary,
            parameters: format.serdeParameters,
          },
          columns: fields.map((field) => ({
            name: logColumnName(field),
            /*
             * Every column is a string, in both formats. CloudFront's Parquet
             * writer goes through Avro and types all eleven fields
             * `["null","string"]`, and its JSON writer quotes every value,
             * `timestamp(ms)` and `sc-status` included. Both were read back
             * off S3 in KensioSoftware/rainlytics#9.
             *
             * A column declared `bigint` over that data fails the query with
             * HIVE_BAD_DATA. The casting belongs in the rollup.
             */
            type: "string",
            comment: field.readBy,
          })),
        },
      },
    });

    // The table names its database as a string, so nothing in the template
    // says which has to exist first.
    this.table.addResourceDependency(this.database);
  }
}
