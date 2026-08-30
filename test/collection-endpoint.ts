/**
 * A real HTTP server standing in for the collection path, for the beacon's
 * own tests.
 *
 * The beacon sends a GET and reads nothing back, so what it does is only
 * visible from the other end. This is that end. The server answers 204, which
 * is what the CloudFront Function `BeaconPath` deploys answers, and records
 * the request line it was asked for.
 *
 * A real server rather than a replaced `fetch`. The request that arrives here
 * went through the browser's own URL resolution and its own encoding, so a
 * path or a query string built wrongly fails here the way it would in a site.
 * A recorded call would agree with whatever the beacon passed.
 *
 * The document's URL is pointed at the server, because the beacon sends to a
 * path rather than to a URL. That is what a site deploys, and it is what
 * `mode: "same-origin"` on the request is asserting.
 */

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

/** The collection path, running. */
export interface CollectionEndpoint {
  /** The request lines the server has been asked for, in arrival order. */
  readonly requests: readonly string[];

  /**
   * Resolves once `count` requests have arrived, with all of them.
   *
   * The beacon sends and forgets, so a case cannot read `requests` the
   * moment after it acts. This is how a case waits for the send it caused
   * without sleeping for a guess at how long that takes.
   */
  received: (count: number) => Promise<readonly string[]>;

  /** Stops the server. */
  close: () => Promise<void>;
}

/** Whatever happy-dom hangs on the global, for the two calls that need it. */
interface HappyDom {
  readonly setURL: (url: string) => void;
  readonly waitUntilComplete: () => Promise<void>;
}

/** happy-dom's own handle on the window a test is running against. */
const happyDom = (): HappyDom =>
  (globalThis as unknown as { happyDOM: HappyDom }).happyDOM;

/**
 * Waits for every request the page has in flight to finish.
 *
 * A send is fire and forget, so a case that provokes one and then ends can
 * leave the browser holding a request whose failure surfaces after the file
 * has finished. Vitest attributes that to the worker rather than to the case,
 * which is a flake that reproduces about one run in ten. This is how a case
 * ends with nothing outstanding.
 */
export async function requestsSettled(): Promise<void> {
  await happyDom().waitUntilComplete();
}

/**
 * Starts the collection path on a port nothing else is using.
 *
 * ```typescript
 * const endpoint = await collectionEndpoint();
 * ```
 */
export async function collectionEndpoint(): Promise<CollectionEndpoint> {
  const requests: string[] = [];
  const waiting: { wanted: number; enough: () => void }[] = [];

  const server = createServer((request, response) => {
    requests.push(request.url ?? "");

    for (const waiter of waiting.splice(0)) {
      if (requests.length >= waiter.wanted) {
        waiter.enough();
      } else {
        waiting.push(waiter);
      }
    }

    response.writeHead(204).end();
  });

  await new Promise<void>((listening) => {
    server.listen(0, "127.0.0.1", listening);
  });

  const { port } = server.address() as AddressInfo;

  happyDom().setURL(`http://127.0.0.1:${String(port)}/`);

  return {
    requests,
    received: async (count) => {
      if (requests.length < count) {
        await new Promise<void>((enough) => {
          waiting.push({ wanted: count, enough });
        });
      }

      return requests;
    },
    close: async () => {
      // Drain first. Closing the server under a request the page still has
      // in flight is the same flake `requestsSettled` exists for.
      await requestsSettled();

      await new Promise<void>((closed) => {
        server.close(() => {
          closed();
        });
      });
    },
  };
}
