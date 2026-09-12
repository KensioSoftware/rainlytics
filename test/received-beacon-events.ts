/**
 * Reading events back out of a request the collection endpoint received.
 *
 * The browser cases assert on what arrived rather than on what they passed
 * in, which is what makes them cases about the envelope and not about their
 * own fixtures. Version 2 packs every event of a request into one parameter,
 * so `URLSearchParams` alone stopped being enough to read one back.
 *
 * This is the browser half of what `beaconEventsOf` does in SQL, and the two
 * unpack the same string the same way. A case here failing while a rollup
 * still passes means one of them has drifted.
 */

import {
  beaconEventFields,
  beaconEventSeparator,
  beaconFieldSeparator,
  beaconParameters,
} from "../src/beacon-events.js";

/** One event as it arrived, every field still text. */
export type ReceivedEvent = Record<(typeof beaconEventFields)[number], string>;

/**
 * Every event one request carried.
 *
 * An empty parameter answers no events, which is what a request carrying no
 * payload should read as. `sendBeaconEvents` makes no such request, so a case
 * seeing one has found a bug.
 */
export function eventsIn(request: string): readonly ReceivedEvent[] {
  const query = new URLSearchParams(request.split("?")[1] ?? "");
  const packed = query.get(beaconParameters.events) ?? "";

  if (packed === "") {
    return [];
  }

  return packed.split(beaconEventSeparator).map((one) => {
    const fields = one.split(beaconFieldSeparator);

    return Object.fromEntries(
      beaconEventFields.map((field, position) => [
        field,
        decodeURIComponent(fields[position] ?? ""),
      ]),
    ) as ReceivedEvent;
  });
}

/**
 * The one event a request carried.
 *
 * Most cases send one thing and want to say so. A request carrying none or
 * several is a failure of the case's own premise, and this says which.
 */
export function theEventIn(request: string): ReceivedEvent {
  const events = eventsIn(request);

  if (events.length !== 1) {
    throw new Error(
      `Expected one event in the request and found ${String(events.length)}.`,
    );
  }

  // The length check above is what makes this safe.
  // oxlint-disable-next-line typescript/no-non-null-assertion
  return events[0]!;
}
