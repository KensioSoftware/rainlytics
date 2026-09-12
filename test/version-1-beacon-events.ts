/**
 * Version 1 of the beacon envelope, for the cases that still read it.
 *
 * The browser stopped writing this shape in #177 and the raw store still
 * holds years of it. Apart from `delivered-beacon-events.ts` because nothing
 * that ships writes one, and a case seeding a partition with both shapes
 * wants the two halves named apart.
 */

import type { BeaconEvent } from "../src/beacon-events.js";
import { beaconParameters } from "../src/beacon-events.js";

import {
  beaconRecord,
  type DeployedBeaconTable,
  putDeliveredRecords,
  type SentEvent,
} from "./delivered-beacon-events.js";

/**
 * One event as version 1 of the envelope sent it.
 *
 * Five parameters, one event, and the three optional ones left out entirely
 * where the event has nothing for them. Reproduced here rather than kept in
 * `src`, because `beaconEventsJoin` is what has to keep reading one and
 * nothing that ships has to keep writing one.
 */
export function version1QueryString(event: BeaconEvent): string {
  const carried: [string, string][] = [
    [beaconParameters.version, "1"],
    [beaconParameters.event, event.event],
    [beaconParameters.page, event.page],
  ];

  if (event.value !== undefined) {
    carried.push([beaconParameters.value, String(event.value)]);
  }

  if (event.subject !== undefined) {
    carried.push([beaconParameters.subject, event.subject]);
  }

  if (event.message !== undefined) {
    carried.push([beaconParameters.message, event.message]);
  }

  return carried
    .map(([name, value]) => `${name}=${encodeURIComponent(value)}`)
    .join("&");
}

/**
 * These events, each delivered as a version 1 record.
 *
 * What a partition written before #177 holds. A case seeding both this and
 * `putDeliveredEvents` puts the two shapes in one partition, which is the
 * arrangement every deployment goes through once.
 */
export async function putDeliveredVersion1Events(
  deployed: DeployedBeaconTable,
  sent: readonly SentEvent[],
): Promise<void> {
  await putDeliveredRecords(
    deployed,
    sent.map((event) => beaconRecord(version1QueryString(event), event)),
  );
}
