// What the log dataset is called in the Glue Data Catalog.
//
// Two halves have to agree about these names and they are deployed a long way
// apart. The CDK construct creates a database and a table under them, and the
// command line writes them into SQL. A disagreement is the quiet kind: a
// query naming a table nobody created fails at the moment somebody asks a
// question, which can be months after the deploy that got the name wrong.
//
// So both halves read this, the way both halves of the partition layout read
// `partition-keys.ts`.

/** What the Data Catalog calls the delivered log dataset. */
export interface LogDataset {
  /** The Glue database holding the table. */
  readonly databaseName: string;

  /** The table describing the delivered objects. */
  readonly tableName: string;
}

/**
 * The names a Rainlytics dataset takes where nobody chooses otherwise.
 *
 * One database per account and one table in it. The table covers every
 * distribution delivering into the bucket, since `distributionid` is the
 * first partition key and a query naming one reads that distribution alone.
 */
export const defaultLogDataset: LogDataset = {
  databaseName: "rainlytics",
  tableName: "cloudfront_logs",
};

/**
 * The dataset as a query names it, quoted.
 *
 * Athena takes double quotes around an identifier. Quoting is habit rather
 * than necessity for the names {@link assertQueryableName} allows, and it
 * keeps a query working if that rule is ever loosened.
 *
 * Both names are checked here as well as where the table is created. The two
 * happen a long way apart, and a caller with names of its own can reach this
 * without ever having gone through the construct. Quoting would carry a name
 * Athena stores lowercased straight into a query that then finds no table.
 *
 * @throws {Error} for a name outside what Athena reads back plainly.
 */
export function qualifiedTableName(
  dataset: LogDataset = defaultLogDataset,
): string {
  assertQueryableName("database", dataset.databaseName);
  assertQueryableName("table", dataset.tableName);

  return `"${dataset.databaseName}"."${dataset.tableName}"`;
}

/** The names Athena reads back without any quoting or escaping. */
const queryableName = /^[a-z][a-z0-9_]*$/u;

/**
 * Refuses a catalog name Athena would make hard to query.
 *
 * Glue takes far more than this. Athena lowercases every name it stores and
 * reads back only letters, digits and underscores without backticks, so a
 * database called `Rainlytics Logs` deploys and then answers to a name the
 * caller has to work out.
 *
 * @throws {Error} for a name outside that set.
 */
export function assertQueryableName(what: string, name: string): void {
  if (!queryableName.test(name)) {
    throw new Error(
      `The ${what} name "${name}" is not one Athena queries plainly. Use` +
        ` lowercase letters, digits and underscores, starting with a letter.`,
    );
  }
}
