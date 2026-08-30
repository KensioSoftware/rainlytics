// The browser half of Rainlytics, reached as `@kensio/rainlytics/beacon`.
//
// A site imports this into its own bundle. Everything reachable from here has
// to be code a browser runs, and `scripts/sh/pack-check.sh` holds it to that
// on the built output alongside a budget for what it weighs.

export type { BeaconEvent } from "../beacon-events.js";
export { beaconQueryString, defaultBeaconPath } from "../beacon-events.js";
export {
  type Beacon,
  type BeaconOptions,
  routeEventName,
  startBeacon,
} from "./start.js";
// For a site sending an event without starting a beacon, which is what a
// framework with its own router hook already has the pieces for. `watchRoutes`
// is deliberately not here. It is how `startBeacon` does its job rather than
// something a site has a use for.
export { sendBeaconEvent } from "./send.js";
