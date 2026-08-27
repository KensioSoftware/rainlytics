// Reading back the queries saved in an Athena workgroup.
//
// The SDK is loaded when a lookup actually runs, for the reason
// `athena-query.ts` gives at length. A static import here would turn
// `rainlytics --help` into a missing module under `scripts/sh/pack-check.sh`,
// which runs the packed CLI out of a tarball with no `node_modules` beside
// it.
//
// Athena answers this in two halves. `ListNamedQueries` hands back ids and
// nothing else, so the names and the SQL take a second call. Both are paged,
// and neither is charged for.

import type * as Athena from "@aws-sdk/client-athena";

import { defaultLogDataset } from "../dataset.js";
import type { AthenaClient, AthenaModule } from "./athena-outcome.js";
import { refusalIn, resolvedRegion } from "./athena-region.js";

/** One query as Athena holds it in a workgroup. */
export interface SavedQuery {
  /** The name the console lists it under. */
  readonly name: string;

  /** What it says about itself, where it was saved with a description. */
  readonly description: string | undefined;

  /** The Glue database it was saved to run against. */
  readonly database: string;

  /** The SQL, as it would be sent. */
  readonly sql: string;
}

/** Where to look for saved queries. */
export interface SavedQueryLookup {
  /** The workgroup they are saved in, which is also where they would run. */
  readonly workgroup: string;

  /** The region to ask, or the AWS SDK's default chain where none is given. */
  readonly region: string | undefined;
}

/**
 * One saved query, as the SDK described it.
 *
 * Every field is optional in those types and present in practice. The
 * fallbacks are the gap between the two. `CreateNamedQuery` takes a name, a
 * database and a statement, and refuses a request missing any of them, so a
 * query answering none of that is one Athena should not be holding.
 */
export function savedQueryFrom(query: Athena.NamedQuery): SavedQuery {
  return {
    name: query.Name ?? "",
    description: query.Description,
    database: query.Database ?? defaultLogDataset.databaseName,
    sql: query.QueryString ?? "",
  };
}

/** The most ids one `BatchGetNamedQuery` takes. */
const batchSize = 50;

/**
 * Every query saved in one workgroup, by name.
 *
 * The whole workgroup rather than the one query a caller wanted. A name that
 * matches nothing has to be answered with the names that do, and Athena has
 * no way to ask for one by name in any case. The id is the only handle its
 * API takes, and a name is found by reading them.
 *
 * They come back in the order Athena lists them, which is the order the
 * console shows.
 *
 * @throws {Error} carrying what Athena refused and where it was asked.
 */
export async function savedQueries(
  lookup: SavedQueryLookup,
): Promise<readonly SavedQuery[]> {
  const athena: AthenaModule = await import("@aws-sdk/client-athena");
  const client = new athena.AthenaClient(
    lookup.region === undefined ? {} : { region: lookup.region },
  );

  try {
    return await described(
      client,
      athena,
      await everyId(client, athena, lookup.workgroup),
    );
  } catch (error) {
    throw refusalIn(error, await resolvedRegion(client));
  } finally {
    client.destroy();
  }
}

/**
 * The ids of every query saved in one workgroup.
 *
 * Written as a call rather than a loop, the way the results paging next door
 * is, which is what keeps the token handling in one place. Athena pages this
 * at fifty, so a workgroup holding a few hundred saved queries recurses a
 * handful of frames deep.
 */
async function everyId(
  client: AthenaClient,
  athena: AthenaModule,
  workgroup: string,
  token?: string,
): Promise<readonly string[]> {
  const page = await client.send(
    new athena.ListNamedQueriesCommand({
      WorkGroup: workgroup,
      ...(token === undefined ? {} : { NextToken: token }),
    }),
  );
  const here = page.NamedQueryIds ?? [];

  if (page.NextToken === undefined) {
    return here;
  }

  return [
    ...here,
    ...(await everyId(client, athena, workgroup, page.NextToken)),
  ];
}

/**
 * The queries those ids name, fetched fifty at a time.
 *
 * A batch is asked for and answered whole, and the batches go one after
 * another rather than at once. Nothing here is in a hurry, and a workgroup
 * holding hundreds of saved queries should not open hundreds of requests to
 * be read once.
 *
 * The answer is put back into the order the ids arrived in. Athena answers a
 * batch in an order of its own and reports an id it could not read under
 * `UnprocessedNamedQueryIds`, so walking the ids is what keeps this list
 * stable and leaves the ones it could not read out of it.
 */
async function described(
  client: AthenaClient,
  athena: AthenaModule,
  ids: readonly string[],
): Promise<readonly SavedQuery[]> {
  if (ids.length === 0) {
    return [];
  }

  const asked = ids.slice(0, batchSize);
  const batch = await client.send(
    new athena.BatchGetNamedQueryCommand({ NamedQueryIds: asked }),
  );
  const answered = batch.NamedQueries ?? [];

  return [
    ...asked.flatMap((id) => {
      const query = answered.find((each) => each.NamedQueryId === id);

      return query === undefined ? [] : [savedQueryFrom(query)];
    }),
    ...(await described(client, athena, ids.slice(batchSize))),
  ];
}
