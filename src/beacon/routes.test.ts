// @vitest-environment happy-dom

import { faker } from "@faker-js/faker";
import { describe, expect, it } from "vitest";

import { watchRoutes } from "./routes.js";

describe("watching a single-page app change route", () => {
  /** A page under a name no other case is using. */
  const aPage = (): string => `/${faker.lorem.slug()}/`;

  /** The pages the address bar held each time a change was reported. */
  const watchedPages = (): { pages: string[]; stop: () => void } => {
    const pages: string[] = [];
    const stop = watchRoutes(() => {
      pages.push(location.pathname);
    });

    return { pages, stop };
  };

  it("reports a push with the new page already in the address bar", () => {
    // Given a router about to move to another page.
    const { pages, stop } = watchedPages();
    const page = aPage();

    // When it pushes.
    history.pushState({}, "", page);

    // Then the change is reported with the page it moved to. Reporting
    // before the address bar moved would name the page being left.
    expect(pages).toStrictEqual([page]);

    stop();
  });

  it("reports a replace", () => {
    // Given a router that replaces rather than pushes, which is what a
    // redirect and a canonicalised URL both do.
    const { pages, stop } = watchedPages();
    const page = aPage();

    // When it replaces.
    history.replaceState({}, "", page);

    // Then that is reported too. Neither method fires an event of its own,
    // so both are wrapped.
    expect(pages).toStrictEqual([page]);

    stop();
  });

  it("reports the back button", async () => {
    // Given somebody who has moved forward once.
    const first = aPage();
    history.pushState({}, "", first);
    const { pages, stop } = watchedPages();
    history.pushState({}, "", aPage());

    // When they go back. The listener goes on before the navigation, since
    // `popstate` fires during it.
    const popped = new Promise<void>((fired) => {
      addEventListener("popstate", () => {
        fired();
      });
    });
    history.back();
    await popped;

    // Then the page they went back to is reported. `popstate` is the only
    // one of the three that fires an event without being wrapped.
    expect(pages.at(-1)).toBe(first);

    stop();
  });

  it("hears nothing once it has been stopped", () => {
    // Given a watch that has been stopped, which is what a site withdrawing
    // consent leaves behind.
    const { pages, stop } = watchedPages();
    stop();

    // When the router moves twice over.
    history.pushState({}, "", aPage());
    history.replaceState({}, "", aPage());

    // Then neither reaches it. Stopping puts back the methods it wrapped, so
    // a site starting and stopping a beacon several times stacks nothing.
    expect(pages).toStrictEqual([]);
  });

  it("leaves a wrapper somebody else added still running", () => {
    // Given a beacon watching, and a router that wraps `pushState` after it.
    const { pages, stop } = watchedPages();
    const alsoSeen: string[] = [];
    const ours = history.pushState.bind(history);
    history.pushState = (...args: Parameters<History["pushState"]>): void => {
      ours(...args);
      alsoSeen.push(location.pathname);
    };

    // When the router pushes.
    const page = aPage();
    history.pushState({}, "", page);

    // Then both wrappers ran. Every wrapper on the page calls the one it
    // found, and this is the beacon holding up its end of that.
    expect(pages).toStrictEqual([page]);
    expect(alsoSeen).toStrictEqual([page]);

    stop();
  });
});
