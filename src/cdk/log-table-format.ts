// How Athena reads back each format CloudFront can deliver.
//
// The SerDe, the two Hadoop format classes and the column names all differ by
// output format, and a table that guesses wrong fails in the worst way this
// project has. Athena matches Parquet columns by name, finds no `cs(Referer)`
// in a file that spells it `cs_Referer`, and answers null for every row of
// every column. The query succeeds, it scans and bills for the bytes, and the
// result looks like a site nobody visited.

import { type DeliveredLogField, logColumnName } from "../log-fields.js";
import type { LogOutputFormat } from "./log-delivery.js";

/** What a Glue table carries so that Athena can read one format. */
export interface LogTableFormat {
  /** What the table holds, which is what the Glue console shows. */
  readonly classification: string;

  /** The Hadoop class that reads the objects. */
  readonly inputFormat: string;

  /** The Hadoop class that would write them. */
  readonly outputFormat: string;

  /** The SerDe that turns a record into columns. */
  readonly serializationLibrary: string;

  /** What that SerDe is configured with. */
  readonly serdeParameters: Readonly<Record<string, string>>;
}

const parquet: LogTableFormat = {
  classification: "parquet",
  inputFormat: "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
  outputFormat:
    "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
  serializationLibrary:
    "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
  serdeParameters: { "serialization.format": "1" },
};

/**
 * How a JSON table finds CloudFront's own field names.
 *
 * A JSON record arrives with the names the delivery asked for, so it carries
 * `"cs(Referer)"` and `"timestamp(ms)"` as keys. Athena reads back letters,
 * digits and underscores, so the column cannot be called that. The OpenX
 * SerDe bridges the two with a `mapping.<column>` parameter per field, and
 * [documents this case](https://docs.aws.amazon.com/athena/latest/ug/openx-json-serde.html).
 *
 * `case.insensitive` is off so that the mapping values are the record's own
 * keys. Left on, the SerDe lowercases every key before matching and each
 * mapping would have to name `cs(referer)`, spelled differently from anything
 * on S3 and from anything in `log-fields.ts`.
 *
 * AWS recommends the Hive JSON SerDe over this one, on the grounds that OpenX
 * can return non-deterministic values. That SerDe has no `mapping` property
 * at all, so the choice is between a caution AWS has published and a table
 * that cannot name its columns. Parquet needs neither, and it is the reason
 * this arm is worth keeping an eye on.
 */
function json(fields: readonly DeliveredLogField[]): LogTableFormat {
  const mappings: Record<string, string> = {};

  // One per field, including any whose column name already matches the
  // record key. A mapping that changes nothing costs a table parameter, and
  // it keeps this from being a rule about which fields are special.
  for (const field of fields) {
    mappings[`mapping.${logColumnName(field)}`] = field.name;
  }

  return {
    classification: "json",
    inputFormat: "org.apache.hadoop.mapred.TextInputFormat",
    outputFormat: "org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat",
    serializationLibrary: "org.openx.data.jsonserde.JsonSerDe",
    serdeParameters: { "case.insensitive": "FALSE", ...mappings },
  };
}

/**
 * How a table reads the format a delivery writes.
 *
 * @throws {Error} for a format Rainlytics has no table definition for.
 */
export function logTableFormat(
  format: LogOutputFormat,
  fields: readonly DeliveredLogField[],
): LogTableFormat {
  if (format === "parquet") {
    return parquet;
  }

  if (format === "json") {
    return json(fields);
  }

  throw new Error(
    `A Rainlytics table cannot read ${format} output. CloudFront writes the` +
      ` plain, w3c and raw formats as delimited text with a header, and the` +
      ` field set and quoting that would take are untested here. Deliver` +
      ` json or parquet.`,
  );
}
